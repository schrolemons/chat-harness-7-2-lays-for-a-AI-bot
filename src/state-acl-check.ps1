param([string]$Target=$env:QQ_STATE_ACL_TARGET)
$ErrorActionPreference = 'Stop'
$repair = $env:QQ_STATE_ACL_REPAIR -eq '1'
$checked = 0
$links = 0
try {
  $root = [IO.DirectoryInfo]::new($Target)
  $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $required = @($userSid, 'S-1-5-18', 'S-1-5-32-544')
  $broad = @('S-1-5-11', 'S-1-5-32-545', 'S-1-1-0')
  $full = [int][Security.AccessControl.FileSystemRights]::FullControl
  $inherit = [int][Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [int][Security.AccessControl.InheritanceFlags]::ObjectInherit
  $pending = [Collections.Generic.Stack[IO.FileSystemInfo]]::new()
  $pending.Push($root)
  while ($pending.Count -gt 0) {
    $entry = $pending.Pop()
    $isLink = ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    if ($isLink) { $links++ }
    if ($PSVersionTable.PSEdition -eq 'Core') {
      $acl = [IO.FileSystemAclExtensions]::GetAccessControl($entry)
    } else {
      $acl = $entry.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
    }
    $checked++
    if ($repair -and -not $isLink) {
      # Work on actual entries only. icacls /T also follows directory junctions.
      # Keep deny rules and other explicit restrictions; remove broad grants.
      if ($entry.FullName -eq $root.FullName) { $acl.SetAccessRuleProtection($true,$false) }
      foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -in $broad) {
          if ($rule.IsInherited) { $acl.SetAccessRuleProtection($true,$true) }
        }
      }
      foreach ($rule in $acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -in $broad) { $acl.RemoveAccessRuleSpecific($rule) }
      }
      foreach ($sid in $required) {
        $identity = [Security.Principal.SecurityIdentifier]::new($sid)
        $flags = [Security.AccessControl.InheritanceFlags]::None
        if ($entry -is [IO.DirectoryInfo]) { $flags = [Security.AccessControl.InheritanceFlags]$inherit }
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity,[Security.AccessControl.FileSystemRights]::FullControl,$flags,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
        $acl.SetAccessRule($rule)
      }
      if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::SetAccessControl($entry,$acl) }
      else { $entry.SetAccessControl($acl) }
    }
    if ($entry.FullName -eq $root.FullName -and -not $acl.AreAccessRulesProtected) { throw 'Root ACL inherits external permissions' }
    $granted = @{}
    $inheritable = @{}
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      $sid = $rule.IdentityReference.Value
      if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
      if ($sid -in $broad) { throw 'A descendant or root grants access to a broad principal' }
      if ($sid -in $required -and (([int]$rule.FileSystemRights -band $full) -eq $full) -and
          (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0)) {
        $granted[$sid] = $true
        if (([int]$rule.InheritanceFlags -band $inherit) -eq $inherit) { $inheritable[$sid] = $true }
      }
    }
    foreach ($sid in $required) {
      if (-not $granted[$sid]) { throw 'Required owner, SYSTEM or Administrators access is missing' }
      if ($entry.FullName -eq $root.FullName -and -not $inheritable[$sid]) { throw 'Root lacks inheritable protection for new files' }
    }
    # Check the link's own ACL but never traverse into its external target.
    if ($entry -is [IO.DirectoryInfo] -and -not $isLink) {
      foreach ($child in $entry.EnumerateFileSystemInfos()) { $pending.Push($child) }
    }
  }
  @{ok=$true; checked=$checked; links=$links} | ConvertTo-Json -Compress
} catch {
  @{ok=$false; checked=$checked; detail=$_.Exception.Message} | ConvertTo-Json -Compress
}
