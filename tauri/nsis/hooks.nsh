; Ganchos del instalador NSIS de Tauri.
;
; Tauri instala "solo para mi" en %LOCALAPPDATA%\<producto>; la 3.x (Inno
; Setup) instala en %LOCALAPPDATA%\Programs, la carpeta de Windows para los
; programas de un usuario. Se instala alli tambien: es lo esperado y, para la
; 4.0, la carpeta de la 3.x.
;
; (Ojo al probar: un instalador lanzado desde una app empaquetada (MSIX, como
; la app de escritorio de Claude) se instala VIRTUALIZADO en la carpeta privada
; de esa app; el Explorador no ve el programa y los accesos salen sin icono.
; Hay que lanzarlo con doble clic desde el Explorador.)

!macro NSIS_HOOK_PREINSTALL
  ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    ; lo que dejo una instalacion anterior en la carpeta vieja (solo el
    ; programa: la config va en %APPDATA% y los datos de la ventana, aparte)
    Delete "$LOCALAPPDATA\${PRODUCTNAME}\${MAINBINARYNAME}.exe"
    Delete "$LOCALAPPDATA\${PRODUCTNAME}\uninstall.exe"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${PRODUCTNAME}"
    CreateDirectory "$INSTDIR"
    SetOutPath "$INSTDIR"
    ; solo si quedo vacia
    RMDir "$LOCALAPPDATA\${PRODUCTNAME}"
  ${EndIf}
!macroend
