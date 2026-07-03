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
DefaultDirName={autopf}\{#MyAppName}
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
Source: "INSTRUCCIONES.md"; DestDir: "{app}"; Flags: ignoreversion isreadme

[Icons]
Name: "{group}\FichaCSIRC (Registrar horas)"; Filename: "{app}\FichaCSIRC.exe"
Name: "{group}\FichaCSIRC - Configurar"; Filename: "{app}\FichaCSIRC-Configurar.exe"
Name: "{group}\Desinstalar FichaCSIRC"; Filename: "{uninstallexe}"
Name: "{autodesktop}\FichaCSIRC"; Filename: "{app}\FichaCSIRC.exe"; Tasks: desktopicon

[Run]
; Al terminar, ofrecer abrir el configurador (imprescindible la primera vez)
Filename: "{app}\FichaCSIRC-Configurar.exe"; Description: "Configurar FichaCSIRC ahora (necesario la primera vez)"; Flags: nowait postinstall skipifsilent

[Code]
procedure CerrarProceso(const Nombre: String);
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM "' + Nombre + '" /T /F',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function InitializeSetup(): Boolean;
begin
  { Si lo lanza el actualizador, cierra cualquier proceso que bloquee los .exe. }
  Sleep(1500);
  CerrarProceso('FichaCSIRC.exe');
  CerrarProceso('FichaCSIRC-Configurar.exe');
  Sleep(500);
  Result := True;
end;
