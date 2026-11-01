# Streams Windows "now playing" info (Spotify, browsers, VLC, anything using the
# system media controls) as JSON lines on stdout. Accepts commands on stdin:
#   playpause | next | prev
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $task.Wait(-1)
    $task.Result
}

function Emit($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
    [Console]::Out.Flush()
}

$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($mgrType::RequestAsync()) $mgrType

$lastKey = ''
$lastArt = ''
$readTask = [Console]::In.ReadLineAsync()
$tick = 0

while ($true) {
    # --- commands from the app ---
    if ($readTask.IsCompleted) {
        $cmd = $readTask.Result
        if ($null -eq $cmd) { break }   # stdin closed: parent exited
        $readTask = [Console]::In.ReadLineAsync()
        $s = $mgr.GetCurrentSession()
        if ($s) {
            switch ($cmd.Trim()) {
                'playpause' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
                'next'      { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
                'prev'      { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
            }
        }
        $tick = 3   # report fresh state right away
    }

    # --- poll state roughly once a second ---
    if ($tick -ge 3) {
        $tick = 0
        $s = $mgr.GetCurrentSession()
        if (-not $s) {
            if ($lastKey -ne 'none') { Emit @{ active = $false }; $lastKey = 'none' }
        } else {
            $props = Await ($s.TryGetMediaPropertiesAsync()) $propsType
            $tl = $s.GetTimelineProperties()
            $pb = $s.GetPlaybackInfo()
            $key = "$($s.SourceAppUserModelId)|$($props.Title)|$($props.Artist)"
            if ($key -ne $lastKey) {
                $lastKey = $key
                $lastArt = ''
                try {
                    if ($props.Thumbnail) {
                        $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
                        $reader = [Windows.Storage.Streams.DataReader]::new($stream)
                        $null = Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
                        $bytes = New-Object byte[] $stream.Size
                        $reader.ReadBytes($bytes)
                        $lastArt = 'data:image/jpeg;base64,' + [Convert]::ToBase64String($bytes)
                        $reader.Dispose(); $stream.Dispose()
                    }
                } catch { $lastArt = '' }
                $newTrack = $true
            } else { $newTrack = $false }

            $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
            $out = @{
                active   = $true
                playing  = ($pb.PlaybackStatus -eq 4)   # 4 = Playing
                title    = "$($props.Title)"
                artist   = "$($props.Artist)"
                album    = "$($props.AlbumTitle)"
                source   = "$($s.SourceAppUserModelId)"
                position = [math]::Round($tl.Position.TotalSeconds, 1)
                duration = [math]::Round($dur, 1)
            }
            if ($newTrack) { $out.art = $lastArt }
            Emit $out
        }
    }

    Start-Sleep -Milliseconds 250
    $tick++
}
