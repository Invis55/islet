# Read-only reader for the Windows notification database (what feeds Action Center).
# It never touches the original: it copies wpndatabase.db (+ -wal) to a temp folder and
# queries the copy through winsqlite3.dll, which ships with Windows 10/11.
# Output: one JSON line per change: {"items":[{id,t,app,payload}...]} or {"error":"..."}
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$src = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Notifications\wpndatabase.db'
$tmp = Join-Path $env:TEMP 'islet-wpn'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class WinSql {
    const string DLL = "winsqlite3.dll";
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_close(IntPtr db);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int nByte, out IntPtr stmt, IntPtr tail);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_step(IntPtr stmt);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_finalize(IntPtr stmt);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_column_count(IntPtr stmt);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_column_type(IntPtr stmt, int i);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern long sqlite3_column_int64(IntPtr stmt, int i);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr sqlite3_column_blob(IntPtr stmt, int i);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_column_bytes(IntPtr stmt, int i);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr sqlite3_errmsg(IntPtr db);

    static byte[] Z(string s) {
        byte[] b = Encoding.UTF8.GetBytes(s);
        byte[] r = new byte[b.Length + 1];
        Array.Copy(b, r, b.Length);
        return r;
    }
    static string Err(IntPtr db) { return Marshal.PtrToStringAnsi(sqlite3_errmsg(db)); }

    // Integers come back as long, NULL as null, everything else (TEXT/BLOB) as raw bytes.
    public static List<object[]> Query(string path, string sql) {
        IntPtr db;
        // READWRITE on our private temp copy lets SQLite replay the -wal; the original is never opened.
        int rc = sqlite3_open_v2(Z(path), out db, 2, IntPtr.Zero);
        if (rc != 0) {
            string m = db == IntPtr.Zero ? ("code " + rc) : Err(db);
            if (db != IntPtr.Zero) sqlite3_close(db);
            throw new Exception("open: " + m);
        }
        try {
            IntPtr st;
            rc = sqlite3_prepare_v2(db, Z(sql), -1, out st, IntPtr.Zero);
            if (rc != 0) throw new Exception("prepare: " + Err(db));
            try {
                List<object[]> rows = new List<object[]>();
                int n = sqlite3_column_count(st);
                while ((rc = sqlite3_step(st)) == 100) {
                    object[] row = new object[n];
                    for (int i = 0; i < n; i++) {
                        int t = sqlite3_column_type(st, i);
                        if (t == 1) row[i] = sqlite3_column_int64(st, i);
                        else if (t == 5) row[i] = null;
                        else {
                            int len = sqlite3_column_bytes(st, i);
                            byte[] buf = new byte[len];
                            if (len > 0) Marshal.Copy(sqlite3_column_blob(st, i), buf, 0, len);
                            row[i] = buf;
                        }
                    }
                    rows.Add(row);
                }
                if (rc != 101) throw new Exception("step: " + Err(db));
                return rows;
            } finally { sqlite3_finalize(st); }
        } finally { sqlite3_close(db); }
    }
}
"@

function Decode($b) {
    if ($null -eq $b) { return '' }
    $bytes = [byte[]]$b
    if ($bytes.Length -eq 0) { return '' }
    # Payloads are usually UTF-8 XML, but handle UTF-16 just in case.
    if ($bytes.Length -ge 2 -and ($bytes[1] -eq 0 -or ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE))) {
        return [System.Text.Encoding]::Unicode.GetString($bytes).TrimStart([char]0xFEFF)
    }
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Copy-Shared($from, $to) {
    $in = [System.IO.File]::Open($from, 'Open', 'Read', 'ReadWrite,Delete')
    try {
        $out = [System.IO.File]::Create($to)
        try { $in.CopyTo($out) } finally { $out.Dispose() }
    } finally { $in.Dispose() }
}

function Emit($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5))
    [Console]::Out.Flush()
}

$sql = "SELECT n.Id, n.ArrivalTime, n.Payload, h.PrimaryId FROM Notification n LEFT JOIN NotificationHandler h ON n.HandlerId = h.RecordId WHERE n.Type = 'toast' ORDER BY n.ArrivalTime DESC LIMIT 40"
$lastSig = ''
$lastError = ''

while ($true) {
    try {
        if (-not (Test-Path $src)) {
            if ($lastError -ne 'missing') { Emit @{ error = "Notification database not found: $src" }; $lastError = 'missing' }
            Start-Sleep -Seconds 20
            continue
        }
        $sig = (@($src, "$src-wal") | Where-Object { Test-Path $_ } | ForEach-Object {
            $i = Get-Item $_; "$($i.Name):$($i.Length):$($i.LastWriteTimeUtc.Ticks)"
        }) -join '|'

        if ($sig -ne $lastSig) {
            Remove-Item (Join-Path $tmp '*') -Force -ErrorAction SilentlyContinue
            Copy-Shared $src (Join-Path $tmp 'wpn.db')
            if (Test-Path "$src-wal") { Copy-Shared "$src-wal" (Join-Path $tmp 'wpn.db-wal') }
            $rows = [WinSql]::Query((Join-Path $tmp 'wpn.db'), $sql)
            $items = New-Object System.Collections.ArrayList
            foreach ($r in $rows) {
                if ($null -eq $r[1]) { continue }
                $payload = Decode $r[2]
                if ($payload.Length -gt 20000) { $payload = $payload.Substring(0, 20000) }
                [void]$items.Add(@{
                    id      = [int64]$r[0]
                    t       = [int64](([int64]$r[1] - 116444736000000000) / 10000)   # FILETIME -> unix ms
                    app     = (Decode $r[3])
                    payload = $payload
                })
            }
            Emit @{ items = @($items) }
            $lastSig = $sig
            $lastError = ''
        }
    } catch {
        $msg = "$($_.Exception.Message)"
        if ($msg -ne $lastError) { Emit @{ error = $msg }; $lastError = $msg }
        $lastSig = ''
        Start-Sleep -Seconds 10
    }
    Start-Sleep -Seconds 2
}
