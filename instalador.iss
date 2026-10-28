; instalador.iss - Instalador unico de FichaCSIRC (Inno Setup 6)
;
; Desde la 3.0 hay UNA sola aplicacion (interfaz HTML con pywebview): el
; asistente de configuracion va dentro (FichaCSIRC.exe --configurar), con su
; acceso propio en el menu Inicio para que nadie lo eche en falta.
; Instalacion POR USUARIO (no pide permisos de administrador).
;
; Compilar (necesita la carpeta dist\FichaCSIRC de PyInstaller --onedir):
;   iscc /DMyAppVersion=3.0.0 instalador.iss
; (si no se pasa /D, usa la version por defecto de abajo)
; MyAppVersion es la version VISIBLE (puede llevar texto: "3.0.0-candidata").
; VersionInfoVersion exige solo numeros (a.b.c.d): por eso va aparte, en
; MyAppVersionNum; si no se pasa, se usa MyAppVersion (las releases: "3.0.0").

#ifndef MyAppVersion
  #define MyAppVersion "2.1"
#endif
#ifndef MyAppVersionNum
  #define MyAppVersionNum MyAppVersion
#endif
#define MyAppName "FichaCSIRC"
#define MyPublisher "Universidad de Granada - CSIRC"
#define MyUrl "https://github.com/enriquegrx/UGR-FichaCSIRC"

[Setup]
AppId={{B3F1B0A2-4C7E-4E2A-9C3D-FICHACSIRC001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyPublisher}
AppPublisherURL={#MyUrl}
VersionInfoVersion={#MyAppVersionNum}
; Carpeta SIEMPRE por usuario, aunque el instalador se ejecute como
; administrador ({autopf} elevado apuntaria a C:\Program Files y dejaria
; dos instalaciones paralelas, con accesos directos a la copia vieja).
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=FichaCSIRC-Instalador
SetupIconFile=fichacsirc.ico
UninstallDisplayIcon={app}\FichaCSIRC\FichaCSIRC.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos:"; Flags: checkedonce

; Restos de versiones anteriores que NO deben convivir con la nueva:
;  - los .exe sueltos de cuando era --onefile (antes de 2.6.4);
;  - el configurador Tkinter, que desde la 3.0 va dentro de la app;
;  - el _internal de la version Tkinter: copiar encima dejaria sus DLL de Tcl/Tk
;    y modulos viejos mezclados con los nuevos.
[InstallDelete]
Type: files; Name: "{app}\FichaCSIRC.exe"
Type: files; Name: "{app}\FichaCSIRC-Configurar.exe"
Type: filesandordirs; Name: "{app}\FichaCSIRC-Configurar"
Type: filesandordirs; Name: "{app}\FichaCSIRC\_internal"

; La app es una CARPETA (--onedir): el .exe + su _internal (python3XX.dll,
; runtime VC, pythonnet, la interfaz web/...). Va en {app}\FichaCSIRC, la misma
; ruta de siempre: asi la tarea programada del aviso diario sigue valiendo.
[Files]
Source: "dist\FichaCSIRC\*"; DestDir: "{app}\FichaCSIRC"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "INSTRUCCIONES.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\FichaCSIRC (Registrar horas)"; Filename: "{app}\FichaCSIRC\FichaCSIRC.exe"; WorkingDir: "{app}\FichaCSIRC"
Name: "{group}\FichaCSIRC - Configurar"; Filename: "{app}\FichaCSIRC\FichaCSIRC.exe"; Parameters: "--configurar"; WorkingDir: "{app}\FichaCSIRC"
Name: "{group}\Desinstalar FichaCSIRC"; Filename: "{uninstallexe}"
Name: "{autodesktop}\FichaCSIRC"; Filename: "{app}\FichaCSIRC\FichaCSIRC.exe"; WorkingDir: "{app}\FichaCSIRC"; Tasks: desktopicon

[Run]
; Tras una ACTUALIZACION, ofrecer reabrir la app (casilla MARCADA por defecto).
; La app se cerro para actualizarse; al pulsar Finalizar se vuelve a abrir.
; Con --onedir esto YA es seguro: el .exe carga su python3XX.dll desde su carpeta
; _internal, no extrae nada a %TEMP%\_MEI, y desaparece el "Failed to load Python
; DLL" que daban 2.6.1/2.6.2 (que eran --onefile). WorkingDir apunta a su carpeta.
Filename: "{app}\FichaCSIRC\FichaCSIRC.exe"; WorkingDir: "{app}\FichaCSIRC"; Description: "Abrir FichaCSIRC al terminar"; Flags: nowait postinstall skipifsilent; Check: EsActualizacion
; Instalacion nueva: abrir la app, que sin config.json arranca sola el
; asistente (si ya hay config es una actualizacion y la casilla ni aparece).
Filename: "{app}\FichaCSIRC\FichaCSIRC.exe"; WorkingDir: "{app}\FichaCSIRC"; Description: "Abrir FichaCSIRC y configurarlo (necesario la primera vez)"; Flags: nowait postinstall skipifsilent; Check: not EsActualizacion
; Y ofrecer las instrucciones en la web (renderizadas), en vez de un .txt suelto
Filename: "{#MyUrl}/blob/main/INSTRUCCIONES.md"; Description: "Ver las instrucciones de uso (web)"; Flags: postinstall shellexec skipifsilent unchecked

[UninstallRun]
; El aviso diario se programa con schtasks desde la app; si no se borra aqui,
; la tarea queda huerfana tras desinstalar.
Filename: "{sys}\schtasks.exe"; Parameters: "/delete /tn ""FichaCSIRC-Recordatorio"" /f"; Flags: runhidden; RunOnceId: "QuitarRecordatorio"

[Code]
function EsActualizacion(): Boolean;
begin
  { Hay configuracion previa => el usuario ya uso la app antes (actualizacion).
    La config del .exe vive en %APPDATA%\FichaCSIRC. }
  Result := FileExists(ExpandConstant('{userappdata}\FichaCSIRC\config.json'));
end;

function MatarProceso(const Nombre: String): Integer;
var
  ResultCode: Integer;
begin
  { taskkill devuelve 0 si mato algo y 128 si no habia ningun proceso. }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM "' + Nombre + '" /T /F',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := ResultCode;
end;

procedure CerrarProcesos;
var
  Intento, R1, R2: Integer;
begin
  { Insiste hasta que no quede ningun proceso de la app (incluido el aviso
    --recordatorio, que puede llevar dias abierto en segundo plano bloqueando
    los .exe). Si algo no se puede matar, tras ~5 s se sigue adelante y sera
    la copia de archivos la que avise. }
  for Intento := 1 to 10 do
  begin
    R1 := MatarProceso('FichaCSIRC.exe');
    R2 := MatarProceso('FichaCSIRC-Configurar.exe');
    if (R1 <> 0) and (R2 <> 0) then
      Exit;
    Sleep(500);
  end;
end;

function VersionWebView2(Raiz: Integer; const Ruta: String): Boolean;
var
  V: String;
begin
  Result := RegQueryStringValue(Raiz, Ruta, 'pv', V) and (V <> '') and (V <> '0.0.0.0');
end;

function WebView2Instalado(): Boolean;
var
  Clave: String;
begin
  Clave := 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  { La ventana de la 3.0 la dibuja WebView2 (Edge). Viene con Windows 11 y con
    Windows 10 actualizado; se busca donde lo registra Microsoft (equipo de 64
    o 32 bits, o instalado solo para el usuario). }
  Result := VersionWebView2(HKLM, 'SOFTWARE\WOW6432Node\' + Clave)
         or VersionWebView2(HKLM, 'SOFTWARE\' + Clave)
         or VersionWebView2(HKCU, 'Software\' + Clave);
end;

function InitializeSetup(): Boolean;
begin
  { Si lo lanza el actualizador, espera a que la app termine de cerrarse. }
  Sleep(1500);
  CerrarProcesos;
  if not WebView2Instalado() then
    MsgBox('FichaCSIRC necesita "Microsoft Edge WebView2 Runtime", que no está ' +
           'instalado en este equipo (viene con Windows 11 y con Windows 10 ' +
           'actualizado).' + #13#10#13#10 +
           'La instalación continúa, pero la aplicación no abrirá hasta que lo ' +
           'instales: búscalo como "WebView2 Runtime" en la web de Microsoft o ' +
           'pídeselo a tu servicio de informática.', mbInformation, MB_OK);
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  { Justo antes de copiar archivos: el usuario puede tardar en el asistente y
    algo puede haber relanzado la app mientras tanto (p. ej. la tarea
    programada del aviso de fichaje). }
  CerrarProcesos;
  Sleep(500);
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  CerrarProcesos;
  Result := True;
end;
