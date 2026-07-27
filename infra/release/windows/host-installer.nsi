; ============================================================================
; RemoteSupportPro - Host Agent Windows Installer
; Single installer with support-profile (installation type) selection.
;
; Build with:  makensis /DVERSION=0.1.1 host-installer.nsi
; (see build-host-windows-installer.ps1 which stages files and invokes makensis)
;
; Expects a staged payload folder next to this script defined by /DPAYLOAD=...
; containing: dist\, scripts\, package.json
; ============================================================================

Unicode true
ManifestDPIAware true

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef VERSION
  !define VERSION "0.1.1"
!endif
!ifndef PAYLOAD
  !define PAYLOAD "stage-installer"
!endif
!ifndef OUTFILE
  !define OUTFILE "RemoteSupportPro-Host-Setup-v${VERSION}.exe"
!endif

Name "RemoteSupportPro Host Agent ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\RemoteSupportPro\Host"
InstallDirRegKey HKLM "Software\RemoteSupportPro\Host" "InstallDir"
RequestExecutionLevel admin
BrandingText "RemoteSupportPro"

; ---------------------------------------------------------------------------
; Variables collected from custom pages
; ---------------------------------------------------------------------------
Var ControlPlaneUrl
Var TenantId
Var EndpointId
Var InstallProfile          ; remote_only | support_limited_no_folders | support_full

; connection page controls
Var Ctl_Url
Var Ctl_Tenant
Var Ctl_Endpoint

; profile page controls
Var Rb_RemoteOnly
Var Rb_SupportLimited
Var Rb_SupportFull

; ---------------------------------------------------------------------------
; MUI pages
; ---------------------------------------------------------------------------
!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

!insertmacro MUI_PAGE_WELCOME
Page custom ConnPageCreate ConnPageLeave
Page custom ProfilePageCreate ProfilePageLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Spanish"

; ===========================================================================
; Custom page 1: connection settings
; ===========================================================================
Function ConnPageCreate
  !insertmacro MUI_HEADER_TEXT "Connection settings" "Where should this host register?"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "Control-plane URL (e.g. https://cp.example.com):"
  Pop $1
  ${NSD_CreateText} 0 14u 100% 12u "$ControlPlaneUrl"
  Pop $Ctl_Url

  ${NSD_CreateLabel} 0 34u 100% 12u "Tenant ID:"
  Pop $1
  ${NSD_CreateText} 0 48u 100% 12u "$TenantId"
  Pop $Ctl_Tenant

  ${NSD_CreateLabel} 0 68u 100% 12u "Endpoint ID (unique per machine):"
  Pop $1
  ${NSD_CreateText} 0 82u 100% 12u "$EndpointId"
  Pop $Ctl_Endpoint

  nsDialogs::Show
FunctionEnd

Function ConnPageLeave
  ${NSD_GetText} $Ctl_Url $ControlPlaneUrl
  ${NSD_GetText} $Ctl_Tenant $TenantId
  ${NSD_GetText} $Ctl_Endpoint $EndpointId

  ${If} $ControlPlaneUrl == ""
    MessageBox MB_ICONEXCLAMATION "Control-plane URL is required."
    Abort
  ${EndIf}
  ${If} $TenantId == ""
    MessageBox MB_ICONEXCLAMATION "Tenant ID is required."
    Abort
  ${EndIf}
  ${If} $EndpointId == ""
    MessageBox MB_ICONEXCLAMATION "Endpoint ID is required."
    Abort
  ${EndIf}
FunctionEnd

; ===========================================================================
; Custom page 2: installation type = support profile
; ===========================================================================
Function ProfilePageCreate
  !insertmacro MUI_HEADER_TEXT "Installation type" "Choose the support profile for this host."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 20u "The selected profile defines the maximum capabilities this host will expose. It is enforced locally and by the control-plane."
  Pop $1

  ${NSD_CreateRadioButton} 0 26u 100% 10u "Remote only  —  remote session, no support actions on files"
  Pop $Rb_RemoteOnly

  ${NSD_CreateRadioButton} 0 44u 100% 10u "Support limited (no folders)  —  diagnostics/commands, no filesystem access"
  Pop $Rb_SupportLimited

  ${NSD_CreateRadioButton} 0 62u 100% 10u "Support full  —  full support per tenant policy, incl. file capabilities"
  Pop $Rb_SupportFull

  ; default selection based on prior value (default remote_only)
  ${If} $InstallProfile == "support_full"
    ${NSD_Check} $Rb_SupportFull
  ${ElseIf} $InstallProfile == "support_limited_no_folders"
    ${NSD_Check} $Rb_SupportLimited
  ${Else}
    ${NSD_Check} $Rb_RemoteOnly
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function ProfilePageLeave
  ${NSD_GetState} $Rb_SupportFull $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallProfile "support_full"
    Return
  ${EndIf}
  ${NSD_GetState} $Rb_SupportLimited $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallProfile "support_limited_no_folders"
    Return
  ${EndIf}
  StrCpy $InstallProfile "remote_only"
FunctionEnd

; ===========================================================================
; Defaults
; ===========================================================================
Function .onInit
  StrCpy $InstallProfile "remote_only"
FunctionEnd

; ===========================================================================
; Install
; ===========================================================================
Section "Host Agent" SecHost
  SectionIn RO

  ; Require Node.js on PATH (agent runs as a Node service).
  nsExec::ExecToStack 'cmd /c node --version'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Node.js was not found on PATH. Install Node.js (LTS) on this endpoint and run the installer again."
    Abort
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\dist"
  File /r "${PAYLOAD}\scripts"
  File /r "${PAYLOAD}\node_modules"
  File "${PAYLOAD}\package.json"

  ; Persist local capability baseline (install-profile.json).
  FileOpen $9 "$INSTDIR\install-profile.json" w
  FileWrite $9 '{$\r$\n'
  FileWrite $9 '  "installProfile": "$InstallProfile",$\r$\n'
  ${If} $InstallProfile == "remote_only"
    FileWrite $9 '  "supportCommandsAllowed": false,$\r$\n'
  ${Else}
    FileWrite $9 '  "supportCommandsAllowed": true,$\r$\n'
  ${EndIf}
  ${If} $InstallProfile == "support_full"
    FileWrite $9 '  "folderActionsAllowed": true$\r$\n'
  ${Else}
    FileWrite $9 '  "folderActionsAllowed": false$\r$\n'
  ${EndIf}
  FileWrite $9 '}$\r$\n'
  FileClose $9

  WriteRegStr HKLM "Software\RemoteSupportPro\Host" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\RemoteSupportPro\Host" "InstallProfile" "$InstallProfile"
  WriteRegStr HKLM "Software\RemoteSupportPro\Host" "EndpointId" "$EndpointId"

  ; Install and start the Windows service with the chosen profile.
  DetailPrint "Installing Windows service (profile: $InstallProfile)..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\install-windows-service.ps1" -ControlPlaneUrl "$ControlPlaneUrl" -TenantId "$TenantId" -EndpointId "$EndpointId" -InstallProfile "$InstallProfile"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "The host files were installed, but the Windows service could not be created (exit $0). Check the log and run scripts\install-windows-service.ps1 manually."
  ${EndIf}

  ; Uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteSupportProHost" "DisplayName" "RemoteSupportPro Host Agent"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteSupportProHost" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteSupportProHost" "Publisher" "RemoteSupportPro"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteSupportProHost" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteSupportProHost" "InstallLocation" "$INSTDIR"
SectionEnd

; ===========================================================================
; Uninstall
; ===========================================================================
Section "Uninstall"
  DetailPrint "Stopping and removing Windows service..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\stop-windows-service.ps1" -EndpointId "$EndpointId"'
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\uninstall-windows-service.ps1" -EndpointId "$EndpointId"'

  Delete "$INSTDIR\install-profile.json"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\dist"
  RMDir /r "$INSTDIR\scripts"
  RMDir /r "$INSTDIR\node_modules"
  RMDir "$INSTDIR"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteSupportProHost"
  DeleteRegKey HKLM "Software\RemoteSupportPro\Host"
SectionEnd
