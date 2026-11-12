//! PIN de acceso: el mismo hash que la app de Python (PBKDF2-SHA256 con sal,
//! 200.000 iteraciones por defecto), asi que un PIN puesto alli vale aqui.

use pbkdf2::pbkdf2_hmac;
use serde_json::Value;
use sha2::Sha256;
use subtle::ConstantTimeEq;

pub const ITERACIONES: u32 = 200_000;
pub const FALLOS_LIBRES: u32 = 3;
pub const ESPERA_MAX: i64 = 300;

/// El PIN guardado ({hash, sal, iter}) si lo hay.
pub fn guardado(cfg: &crate::config::Cfg) -> Option<Value> {
    let p = cfg.get("pin")?;
    let ok = p.get("hash").and_then(Value::as_str).is_some_and(|s| !s.is_empty())
        && p.get("sal").and_then(Value::as_str).is_some_and(|s| !s.is_empty());
    ok.then(|| p.clone())
}

pub fn correcto(pin: &str, guardado: &Value) -> bool {
    let (Some(hash), Some(sal)) = (guardado["hash"].as_str(), guardado["sal"].as_str()) else {
        return false;
    };
    let Ok(sal) = hex::decode(sal) else { return false };
    let iter = guardado["iter"].as_u64().map(|i| i as u32).unwrap_or(ITERACIONES);
    let mut out = [0u8; 32];
    pbkdf2_hmac::<Sha256>(pin.trim().as_bytes(), &sal, iter, &mut out);
    hex::encode(out).as_bytes().ct_eq(hash.to_lowercase().as_bytes()).into()
}

/// Segundos de espera tras `fallos` fallos seguidos (0 los primeros).
pub fn espera(fallos: u32) -> i64 {
    if fallos <= FALLOS_LIBRES {
        return 0;
    }
    (5i64 << (fallos - FALLOS_LIBRES - 1).min(20)).min(ESPERA_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn el_hash_de_python_vale() {
        // calculado con la app de Python:
        // hashlib.pbkdf2_hmac('sha256', b'1234', bytes.fromhex('0011...eeff'), 1000).hex()
        let g = json!({"hash": "b8ad0f1dacec0beb4f418fadcb2ee5939ef45823391bb89692028dd1b67e9cef",
                       "sal": "00112233445566778899aabbccddeeff", "iter": 1000});
        assert!(correcto("1234", &g));
        assert!(!correcto("1235", &g));
    }

    #[test]
    fn esperas_crecientes() {
        assert_eq!((espera(1), espera(3), espera(4), espera(5), espera(6)), (0, 0, 5, 10, 20));
        assert_eq!(espera(30), ESPERA_MAX);
    }

    #[test]
    fn ida_y_vuelta() {
        let sal = "00112233445566778899aabbccddeeff";
        let mut out = [0u8; 32];
        pbkdf2_hmac::<Sha256>(b"4321", &hex::decode(sal).unwrap(), 1000, &mut out);
        let g = json!({"hash": hex::encode(out), "sal": sal, "iter": 1000});
        assert!(correcto("4321", &g));
        assert!(correcto(" 4321 ", &g));
        assert!(!correcto("4322", &g));
    }
}
