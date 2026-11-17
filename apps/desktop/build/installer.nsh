; Oakqueill installer additions (electron-builder picks up build/installer.nsh on its own).
;
; Browser viewer: offers to add Oakqueill PDF Viewer to Chrome and Microsoft Edge. Like Adobe Acrobat, this uses the
; browsers' "external extensions" registry keys: the installer only names the extension's store ID, the browser then
; downloads it from its own store and asks the user to turn it on. Nothing is installed silently, and the browsers only
; accept extensions published in their stores.
;
; Fill in the IDs the Chrome Web Store and Edge Add-ons assign when the extension is published. While an ID is empty,
; that browser is left out; while both are empty, the installer shows no page and writes nothing.
!ifndef OAKQ_CHROME_EXTENSION_ID
  !define OAKQ_CHROME_EXTENSION_ID ""
!endif
!ifndef OAKQ_EDGE_EXTENSION_ID
  !define OAKQ_EDGE_EXTENSION_ID ""
!endif

!define OAKQ_CHROME_UPDATE_URL "https://clients2.google.com/service/update2/crx"
!define OAKQ_EDGE_UPDATE_URL "https://edge.microsoft.com/extensionwebstorebase/v1/crx"
; tests point this at a scratch key; the browsers read the keys below HKCU / HKLM\Software directly
!ifndef OAKQ_REG_BASE
  !define OAKQ_REG_BASE ""
!endif

!if "${OAKQ_CHROME_EXTENSION_ID}${OAKQ_EDGE_EXTENSION_ID}" != ""
  !define OAKQ_BROWSER_VIEWER
  !if "${OAKQ_CHROME_EXTENSION_ID}" == ""
    !define OAKQ_BROWSERS "Microsoft Edge"
  !else if "${OAKQ_EDGE_EXTENSION_ID}" == ""
    !define OAKQ_BROWSERS "Google Chrome"
  !else
    !define OAKQ_BROWSERS "Google Chrome and Microsoft Edge"
  !endif
!endif

; Writes (ACTION "write") or removes (ACTION "delete") the browsers' keys for this install's scope (HKCU for "just me",
; HKLM for all users). For all users, Chrome and Edge read the 32-bit view (Software\WOW6432Node) on 64-bit Windows.
!macro oakqBrowserKeys ACTION
  !ifdef OAKQ_BROWSER_VIEWER
    SetRegView 32
    !if "${OAKQ_CHROME_EXTENSION_ID}" != ""
      !if "${ACTION}" == "write"
        WriteRegStr SHCTX "${OAKQ_REG_BASE}Software\Google\Chrome\Extensions\${OAKQ_CHROME_EXTENSION_ID}" "update_url" "${OAKQ_CHROME_UPDATE_URL}"
      !else
        DeleteRegKey SHCTX "${OAKQ_REG_BASE}Software\Google\Chrome\Extensions\${OAKQ_CHROME_EXTENSION_ID}"
      !endif
    !endif
    !if "${OAKQ_EDGE_EXTENSION_ID}" != ""
      !if "${ACTION}" == "write"
        WriteRegStr SHCTX "${OAKQ_REG_BASE}Software\Microsoft\Edge\Extensions\${OAKQ_EDGE_EXTENSION_ID}" "update_url" "${OAKQ_EDGE_UPDATE_URL}"
      !else
        DeleteRegKey SHCTX "${OAKQ_REG_BASE}Software\Microsoft\Edge\Extensions\${OAKQ_EDGE_EXTENSION_ID}"
      !endif
    !endif
    SetRegView lastused
  !endif
!macroend

!ifdef OAKQ_BROWSER_VIEWER
!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  ; "1" to add the viewer, "0" not to; kept with the install so updates repeat the earlier choice
  Var oakqBrowserViewer
  Var oakqBrowserViewerBox

  !macro customInit
    ReadRegStr $oakqBrowserViewer SHCTX "${INSTALL_REGISTRY_KEY}" "BrowserViewer"
    ${If} $oakqBrowserViewer == ""
      ; a first install offers it ticked; an unattended one (/S) adds nothing nobody saw
      ${If} ${Silent}
        StrCpy $oakqBrowserViewer "0"
      ${Else}
        StrCpy $oakqBrowserViewer "1"
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Page custom oakqBrowserPageShow oakqBrowserPageLeave

    Function oakqBrowserPageShow
      ${If} ${isUpdated}
        Abort
      ${EndIf}
      !insertmacro MUI_HEADER_TEXT "Browser viewer" "Open PDFs from the web with Oakqueill."
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}
      ${NSD_CreateLabel} 0 0 100% 52u "Oakqueill PDF Viewer is a small add-on for ${OAKQ_BROWSERS}. It opens PDFs from websites and from your disk in Oakqueill's viewer, with zoom, find, print and save.$\r$\n$\r$\nThe browser downloads it from its add-on store and asks you to turn it on the next time it starts. You can remove it there at any time; uninstalling Oakqueill removes it too."
      Pop $0
      ${NSD_CreateCheckbox} 0 60u 100% 12u "&Add Oakqueill PDF Viewer to ${OAKQ_BROWSERS}"
      Pop $oakqBrowserViewerBox
      ${If} $oakqBrowserViewer == "1"
        ${NSD_Check} $oakqBrowserViewerBox
      ${EndIf}
      nsDialogs::Show
    FunctionEnd

    Function oakqBrowserPageLeave
      ${NSD_GetState} $oakqBrowserViewerBox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $oakqBrowserViewer "1"
      ${Else}
        StrCpy $oakqBrowserViewer "0"
      ${EndIf}
    FunctionEnd
  !macroend

  !macro customInstall
    ${If} $oakqBrowserViewer == "1"
      !insertmacro oakqBrowserKeys write
    ${Else}
      ; unticked on a reinstall: take back what an earlier install added
      !insertmacro oakqBrowserKeys delete
    ${EndIf}
    WriteRegStr SHCTX "${INSTALL_REGISTRY_KEY}" "BrowserViewer" "$oakqBrowserViewer"
  !macroend
!endif

; Updates run the old uninstaller first; the keys stay so the browsers keep the viewer.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    !insertmacro oakqBrowserKeys delete
  ${EndIf}
!macroend
!endif
