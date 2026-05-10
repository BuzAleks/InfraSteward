Var InfraStewardDataDir

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $InfraStewardDataDir HKCU "Software\InfraSteward" "WorkingDataDir"
  ${If} $InfraStewardDataDir == ""
    StrCpy $InfraStewardDataDir "$LOCALAPPDATA\InfraSteward"
  ${EndIf}

  MessageBox MB_YESNO|MB_ICONQUESTION "InfraSteward will store app data, insecure fallback secrets, and system logs in:$\r$\n$\r$\n$InfraStewardDataDir$\r$\n$\r$\nUse this working directory?" IDYES +4
  nsDialogs::SelectFolderDialog "Select InfraSteward working directory" "$InfraStewardDataDir"
  Pop $0
  ${If} $0 != "error"
    StrCpy $InfraStewardDataDir $0
  ${EndIf}

  CreateDirectory "$InfraStewardDataDir"
  CreateDirectory "$InfraStewardDataDir\logs"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\InfraSteward" "WorkingDataDir" "$InfraStewardDataDir"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\InfraSteward" "WorkingDataDir"
  DeleteRegKey /ifempty HKCU "Software\InfraSteward"
!macroend
