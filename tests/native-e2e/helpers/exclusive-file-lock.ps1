param(
    [Parameter(Mandatory = $true)]
    [string]$TargetPath,
    [Parameter(Mandatory = $true)]
    [string]$ReadyPath,
    [Parameter(Mandatory = $true)]
    [string]$ReleasePath
)

$stream = $null

try {
    $stream = [System.IO.File]::Open(
        $TargetPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
    [System.IO.File]::WriteAllText($ReadyPath, "ready")

    while (-not [System.IO.File]::Exists($ReleasePath)) {
        Start-Sleep -Milliseconds 20
    }
}
finally {
    if ($null -ne $stream) {
        $stream.Dispose()
    }
}
