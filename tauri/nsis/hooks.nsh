; Ganchos del instalador NSIS de Tauri.
;
; (Este fichero va en UTF-8 CON BOM a proposito: Tauri lo incluye sin decir la
; codificacion y, sin BOM, NSIS lo leeria en la pagina de codigos del equipo
; que compila: las tildes de los mensajes saldrian rotas.)
;
; Tauri instala "solo para mi" en %LOCALAPPDATA%\<producto>; la 3.x (Inno
; Setup) instala en %LOCALAPPDATA%\Programs, la carpeta de Windows para los
; programas de un usuario. Se instala alli tambien: es lo esperado y, para la
; 4.0, la carpeta de la 3.x.
;
; El instalador de PRODUCCION (producto "FichaCSIRC": sin tauri.pruebas.json y
; con --features produccion) SUSTITUYE a la 3.x: la cierra, y con el programa
; nuevo ya copiado retira el viejo (ficheros, entrada en "Aplicaciones
; instaladas" y accesos del menu Inicio) y deja el acceso del escritorio y el
; inicio con Windows apuntando al nuevo. El de pruebas ("FichaCSIRC-Rust") no
; toca nada de la 3.x: conviven.
;
; (Ojo al probar: un instalador lanzado desde una app empaquetada (MSIX, como
; la app de escritorio de Claude) se instala VIRTUALIZADO en la carpeta privada
; de esa app; el Explorador no ve el programa y los accesos salen sin icono.
; Hay que lanzarlo con doble clic desde el Explorador.)

; La 3.x en "Aplicaciones instaladas" (AppId de instalador.iss + "_is1")
!define CLAVE_3X "Software\Microsoft\Windows\CurrentVersion\Uninstall\{B3F1B0A2-4C7E-4E2A-9C3D-FICHACSIRC001}_is1"
!define CLAVE_RUN "Software\Microsoft\Windows\CurrentVersion\Run"

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

  !if "${PRODUCTNAME}" == "FichaCSIRC"
    ; Cerrar FichaCSIRC antes de copiar: la ventana y el aviso diario
    ; (--recordatorio), que puede llevar un rato abierto. Como el instalador
    ; de la 3.x: por nombre y SIN /T (arbol de procesos), porque cuando es la
    ; propia app la que lanza este instalador ("Actualizar"), el instalador es
    ; hijo suyo y con /T se mataria a si mismo. Tauri solo mira su propio
    ; ejecutable (por ruta): a la 3.x, que vive en otra carpeta, no la ve.
    ; taskkill devuelve 0 si cerro algo y 128 si ya no quedaba ninguno.
    cerrar_fichacsirc:
    StrCpy $R9 0
    ${Do}
      nsExec::Exec '"$SYSDIR\taskkill.exe" /IM "FichaCSIRC.exe" /F'
      Pop $R8
      ${IfThen} $R8 != 0 ${|} ${ExitDo} ${|}
      Sleep 500
      IntOp $R9 $R9 + 1
    ${LoopUntil} $R9 >= 10

    ; ...y COMPROBAR que la 3.x se ha cerrado, que taskkill puede no poder: si el
    ; instalador corre con menos permisos que la app (paso de verdad: abierto
    ; desde las descargas de Firefox en una sesion de Administrador, donde
    ; Firefox baja a integridad media y la app, lanzada desde el Explorador,
    ; esta en alta), devuelve "Acceso denegado" y la 3.x sigue en marcha. Se
    ; instalaba igual y quedaban la 3.x abierta y media carpeta suya sin borrar.
    ; Un .exe en marcha no se deja abrir para escribir: asi se sabe sin
    ; depender de taskkill. Si sigue abierta, se pide cerrarla; con "Cancelar"
    ; no se instala nada (aun no se ha copiado ningun fichero).
    ReadRegStr $R0 HKCU "${CLAVE_3X}" "InstallLocation"
    ${If} $R0 == ""
      StrCpy $R0 "$LOCALAPPDATA\Programs\FichaCSIRC"
    ${EndIf}
    StrCpy $R1 $R0 1 -1
    ${If} $R1 == "\"
      StrCpy $R0 $R0 -1
    ${EndIf}
    ${If} ${FileExists} "$R0\FichaCSIRC\FichaCSIRC.exe"
      ClearErrors
      FileOpen $R7 "$R0\FichaCSIRC\FichaCSIRC.exe" a
      ${If} ${Errors}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "FichaCSIRC sigue abierta y no se ha podido cerrar.$\n$\nCiérrala y pulsa Reintentar. Si tiene icono junto al reloj: botón derecho sobre él y Salir.$\n$\nSi no ves ni su ventana ni su icono, ciérrala desde el Administrador de tareas (Ctrl+Mayús+Esc): pestaña Detalles, FichaCSIRC.exe, Finalizar tarea." /SD IDCANCEL IDRETRY cerrar_fichacsirc
        Abort "FichaCSIRC sigue abierta: no se ha instalado nada. Ciérrala y vuelve a abrir el instalador."
      ${Else}
        FileClose $R7
      ${EndIf}
    ${EndIf}
  !endif
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; "Editor" en "Aplicaciones instaladas": el mismo que ponia la 3.x (Tauri
  ; deja "ugr", sacado del identificador). Se escribe aqui y no con
  ; bundle.publisher porque Tauri usa ese valor tambien como nombre de su
  ; clave del registro (Software\<editor>\<producto>, donde guarda la carpeta
  ; de instalacion): cambiarlo dejaria sin ella a quien ya tenga instalada una
  ; version anterior de la 4.x, y su "desinstalar antes de instalar" fallaria.
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "Universidad de Granada - CSIRC"

  !if "${PRODUCTNAME}" == "FichaCSIRC"
    ; --- La 4.x sustituye a la 3.x (Inno Setup) ---
    ; NO se usa el desinstalador de la 3.x: borraria la tarea programada del
    ; aviso diario (y con ella, su hora). La tarea se queda: la app la apunta
    ; sola al programa nuevo, a la misma hora, la primera vez que se abre.
    ; La configuracion (%APPDATA%\FichaCSIRC) no se toca.
    ReadRegStr $R0 HKCU "${CLAVE_3X}" "InstallLocation"
    ${If} $R0 == ""
      StrCpy $R0 "$LOCALAPPDATA\Programs\FichaCSIRC"
    ${EndIf}
    StrCpy $R1 $R0 1 -1
    ${If} $R1 == "\"
      StrCpy $R0 $R0 -1
    ${EndIf}
    ${If} ${FileExists} "$R0\FichaCSIRC\FichaCSIRC.exe"
    ${OrIf} ${FileExists} "$R0\unins000.exe"
      ; el programa: la 3.x vivia en la subcarpeta FichaCSIRC (el .exe y su
      ; _internal con Python); el de la 4.x esta al lado, en $INSTDIR
      RMDir /r "$R0\FichaCSIRC"
      ${If} ${FileExists} "$R0\FichaCSIRC\*.*"
        Sleep 1500          ; algun proceso recien cerrado aun soltaba sus ficheros
        RMDir /r "$R0\FichaCSIRC"
      ${EndIf}
      Delete "$R0\unins000.exe"
      Delete "$R0\unins000.dat"
      Delete "$R0\unins000.msg"
      Delete "$R0\INSTRUCCIONES.md"
      ; su entrada en "Aplicaciones instaladas" (queda la de la 4.x)
      DeleteRegKey HKCU "${CLAVE_3X}"
      ; sus accesos del menu Inicio (el de la 4.x es $SMPROGRAMS\FichaCSIRC.lnk)
      Delete "$SMPROGRAMS\FichaCSIRC\FichaCSIRC (Registrar horas).lnk"
      Delete "$SMPROGRAMS\FichaCSIRC\FichaCSIRC - Configurar.lnk"
      Delete "$SMPROGRAMS\FichaCSIRC\Desinstalar FichaCSIRC.lnk"
      RMDir "$SMPROGRAMS\FichaCSIRC"
      ; su acceso del escritorio (se llama igual): al programa nuevo
      ${If} ${FileExists} "$DESKTOP\FichaCSIRC.lnk"
        CreateShortcut "$DESKTOP\FichaCSIRC.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      ${EndIf}
    ${EndIf}
    ; inicio con Windows: quien lo tuviera activado, con el programa nuevo
    ReadRegStr $R1 HKCU "${CLAVE_RUN}" "FichaCSIRC"
    ${If} $R1 != ""
      WriteRegStr HKCU "${CLAVE_RUN}" "FichaCSIRC" '"$INSTDIR\${MAINBINARYNAME}.exe" --minimizado'
    ${EndIf}
  !endif
!macroend
