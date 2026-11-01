# Claude Code hook -> Islet. Reads the hook JSON on stdin, forwards it to the local Islet
# server and, for permission requests, prints Claude Code's decision JSON.
# If Islet isn't running, or anything goes wrong, this exits silently with code 0 so Claude Code is never blocked.
$ErrorActionPreference = 'SilentlyContinue'
try {
    [Console]::InputEncoding = [System.Text.Encoding]::UTF8
    $in = [Console]::In.ReadToEnd()
    $port = if ($env:ISLET_PORT) { $env:ISLET_PORT } else { '47615' }
    $isPermission = $in -match '"hook_event_name"\s*:\s*"PermissionRequest"'

    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$port/claude")
    $req.Method = 'POST'
    $req.ContentType = 'application/json'
    $req.Proxy = $null
    $req.Timeout = if ($isPermission) { 95000 } else { 1500 }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($in)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $resp = $req.GetResponse()
    $text = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
    $resp.Close()

    if ($isPermission) {
        $decision = ($text | ConvertFrom-Json).decision
        if ($decision -eq 'allow') {
            [Console]::Out.Write('{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}')
        } elseif ($decision -eq 'deny') {
            [Console]::Out.Write('{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied from Islet"}}}')
        }
        # 'none' (timeout / answered in the terminal): print nothing, Claude Code shows its normal prompt
    }
} catch { }
exit 0
