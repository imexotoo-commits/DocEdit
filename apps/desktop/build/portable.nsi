; Oakqueill Portable: unpacks the app into a temporary folder, runs it, and removes the folder when it closes.
; Built by scripts/build-portable.mjs, which defines OUT_FILE, APP_ARCHIVE, FRAMES_DIR, FRAME_COUNT, ICON, VERSION,
; VERSION_4 and PLUGINS_DIR. While unpacking it shows the splash: an 8-bit quill writing a line of ink, one frame
; further for each step of progress, so the line is complete when the app is ready.

Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor lzma
; same as electron-builder's portable target: a CRC check of a 100 MB file only delays the start
CRCCheck off
WindowIcon off
AutoCloseWindow true
ShowInstDetails nevershow
SilentInstall normal

!addplugindir /x86-unicode "${PLUGINS_DIR}"
!include "FileFunc.nsh"

Name "Oakqueill Portable"
Caption "Oakqueill Portable"
OutFile "${OUT_FILE}"
Icon "${ICON}"

VIProductVersion "${VERSION_4}"
VIAddVersionKey "ProductName" "Oakqueill PDF Editor"
VIAddVersionKey "FileDescription" "Oakqueill Portable"
VIAddVersionKey "CompanyName" "Oakqueill contributors"
VIAddVersionKey "LegalCopyright" "Copyright © 2026 Oakqueill contributors"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

Var shown ; the frame on screen

Function .onGUIInit
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\splash"
  File "${FRAMES_DIR}\*.bmp"
  StrCpy $shown 0
  BgImage::SetBg "$PLUGINSDIR\splash\f00.bmp"
  BgImage::Redraw
FunctionEnd

; Called by Nsis7z as unpacking goes: bytes done, then bytes in total.
Function ShowProgress
  Pop $R1
  Pop $R2
  StrCmp $R2 0 done
  System::Int64Op $R1 * ${FRAME_COUNT}
  Pop $R3
  System::Int64Op $R3 / $R2
  Pop $R3
  IntCmp $R3 ${FRAME_COUNT} 0 +2 0
    IntOp $R3 ${FRAME_COUNT} - 1
  StrCmp $R3 $shown done
  StrCpy $shown $R3
  IntFmt $R4 "%02d" $R3
  BgImage::SetBg "$PLUGINSDIR\splash\f$R4.bmp"
  BgImage::Redraw
  done:
FunctionEnd

Section
  HideWindow

  ; the app archive is already compressed
  SetCompress off
  SetOutPath "$PLUGINSDIR"
  File "/oname=app.7z" "${APP_ARCHIVE}"
  SetCompress auto

  StrCpy $INSTDIR "$PLUGINSDIR\app"
  SetOutPath "$INSTDIR"
  GetFunctionAddress $R0 ShowProgress
  Nsis7z::ExtractWithCallback "$PLUGINSDIR\app.7z" $R0
  Delete "$PLUGINSDIR\app.7z"
  IfFileExists "$INSTDIR\Oakqueill.exe" +3 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Oakqueill could not be unpacked. Check that there is free space in your temporary folder and try again."
    Quit

  ; the last frame (the line written out) for a moment, then the app's own window takes over
  BgImage::SetBg "$PLUGINSDIR\splash\f${LAST_FRAME}.bmp"
  BgImage::Redraw
  BgImage::Destroy

  ; the same variables electron-builder's portable target sets, for anything that looks for them
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "Oakqueill").r0'
  ${GetParameters} $R1
  ExecWait '"$INSTDIR\Oakqueill.exe" $R1' $0
  SetErrorLevel $0

  SetOutPath "$EXEDIR"
  RMDir /r "$INSTDIR"
SectionEnd
