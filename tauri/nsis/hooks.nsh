; Ganchos del instalador NSIS de Tauri.
;
; Tauri instala "solo para mi" en %LOCALAPPDATA%\<producto>. Ahi, en algunos
; equipos (la raiz de AppData\Local hereda permisos que le han ido poniendo
; otras herramientas), el Explorador y el menu Inicio no consiguen leer el
; icono: el acceso sale con el icono generico o en blanco. La 3.x (Inno Setup)
; instala en %LOCALAPPDATA%\Programs, con permisos limpios, y se ve bien: se
; instala alli tambien (y para la 4.0 es la carpeta de la 3.x).

!macro NSIS_HOOK_PREINSTALL
  ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    ; lo que dejo una instalacion anterior en la carpeta vieja (solo el
    ; programa: la config va en %APPDATA% y los datos de la ventana, aparte)
    Delete "$LOCALAPPDATA\${PRODUCTNAME}\${MAINBINARYNAME}.exe"
    Delete "$LOCALAPPDATA\${PRODUCTNAME}\uninstall.exe"
    Delete "$LOCALAPPDATA\${PRODUCTNAME}\fichacsirc.ico"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${PRODUCTNAME}"
    CreateDirectory "$INSTDIR"
    SetOutPath "$INSTDIR"
    ; solo si quedo vacia
    RMDir "$LOCALAPPDATA\${PRODUCTNAME}"
  ${EndIf}
!macroend
