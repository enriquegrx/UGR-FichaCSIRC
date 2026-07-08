; instalador.iss - Instalador unico de FichaCSIRC (Inno Setup 6)
;
; Empaqueta las dos aplicaciones (registro + configurador) en un solo
; instalador, con accesos directos en el menu Inicio y desinstalador.
; Instalacion POR USUARIO (no pide permisos de administrador).
;
; Compilar (necesita dist\FichaCSIRC.exe y dist\FichaCSIRC-Configurar.exe):
;   iscc /DMyAppVersion=2.1 instalador.iss
; (si no se pasa /D, usa la version por defecto de abajo)

#ifndef MyAppVersion
  #define MyAppVersion "2.1"
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
VersionInfoVersion={#MyAppVersion}
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
UninstallDisplayIcon={app}\FichaCSIRC.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos:"; Flags: checkedonce

[Files]
Source: "dist\FichaCSIRC.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\FichaCSIRC-Configurar.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "INSTRUCCIONES.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\FichaCSIRC (Registrar horas)"; Filename: "{app}\FichaCSIRC.exe"
Name: "{group}\FichaCSIRC - Configurar"; Filename: "{app}\FichaCSIRC-Configurar.exe"
Name: "{group}\Desinstalar FichaCSIRC"; Filename: "{uninstallexe}"
Name: "{autodesktop}\FichaCSIRC"; Filename: "{app}\FichaCSIRC.exe"; Tasks: desktopicon

[Run]
; NO se auto-lanza FichaCSIRC.exe al terminar el instalador. Se probo en 2.6.1/2.6.2
; y daba "Failed to load Python DLL ..._MEIxxxx\python312.dll": lanzar el .exe onefile
; recien instalado y sin firmar, justo al acabar el instalador, hace que la DLL
; extraida al temporal _MEI no cargue (tipicamente el antivirus la bloquea en esa
; secuencia). El .exe funciona bien abierto por su icono. Tras actualizar, el usuario
; abre la app desde el acceso directo. (Si se quisiera reabrir sola, la via robusta
; seria empaquetar en modo carpeta --onedir, que evita la extraccion a %TEMP%.)
; Ofrecer el configurador SOLO en una instalacion nueva (si ya hay config.json
; es una actualizacion y no hay que reconfigurar: la casilla ni aparece).
Filename: "{app}\FichaCSIRC-Configurar.exe"; Description: "Configurar FichaCSIRC ahora (necesario la primera vez)"; Flags: nowait postinstall skipifsilent; Check: not EsActualizacion
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

function InitializeSetup(): Boolean;
begin
  { Si lo lanza el actualizador, espera a que la app termine de cerrarse. }
  Sleep(1500);
  CerrarProcesos;
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
