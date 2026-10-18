<?php
/**
 * Sends email with either PHP mail() or a small built-in SMTP client,
 * so no extra libraries (PHPMailer, Composer) need to be uploaded.
 */

declare(strict_types=1);

/**
 * @return array{0: bool, 1: string} [success, detail]
 */
function send_email(string $toEmail, string $toName, string $subject, string $html, string $text): array
{
    if (!filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
        return [false, 'Invalid recipient address'];
    }

    $mail      = registry_config()['mail'];
    $fromEmail = $mail['from_email'];
    $replyTo   = $mail['reply_to'] ?: $fromEmail;
    $boundary  = 'b_' . bin2hex(random_bytes(12));

    $headers = [
        'Date: ' . date('r'),
        'From: ' . encode_header($mail['from_name']) . ' <' . $fromEmail . '>',
        'Reply-To: ' . $replyTo,
        'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . (explode('@', $fromEmail)[1] ?? 'localhost') . '>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
    ];

    $body = "--{$boundary}\r\n"
          . "Content-Type: text/plain; charset=UTF-8\r\n"
          . "Content-Transfer-Encoding: base64\r\n\r\n"
          . chunk_split(base64_encode($text))
          . "--{$boundary}\r\n"
          . "Content-Type: text/html; charset=UTF-8\r\n"
          . "Content-Transfer-Encoding: base64\r\n\r\n"
          . chunk_split(base64_encode($html))
          . "--{$boundary}--\r\n";

    $toHeader = ($toName !== '' ? encode_header(str_replace(["\r", "\n"], '', $toName)) . ' ' : '') . '<' . $toEmail . '>';

    try {
        if (($mail['transport'] ?? 'mail') === 'smtp') {
            smtp_send($mail['smtp'], $fromEmail, $toEmail, $toHeader, encode_header($subject), $headers, $body);
            return [true, 'Sent via SMTP'];
        }

        $params = '-f' . $fromEmail;
        $ok = @mail($toHeader, encode_header($subject), $body, implode("\r\n", $headers), $params);
        return [$ok, $ok ? 'Handed to mail()' : 'mail() returned false'];
    } catch (Throwable $e) {
        error_log('Registry mail error: ' . $e->getMessage());
        return [false, $e->getMessage()];
    }
}

function encode_header(string $value): string
{
    return preg_match('/[^\x20-\x7E]/', $value)
        ? '=?UTF-8?B?' . base64_encode($value) . '?='
        : $value;
}

/**
 * Minimal SMTP client: SSL (port 465) or STARTTLS (587), AUTH LOGIN.
 * Throws RuntimeException with the server's reply on failure.
 */
function smtp_send(array $smtp, string $from, string $to, string $toHeader, string $subject, array $headers, string $body): void
{
    $secure  = $smtp['encryption'] ?? 'ssl';
    $timeout = (int) ($smtp['timeout'] ?? 20);
    $remote  = ($secure === 'ssl' ? 'ssl://' : 'tcp://') . $smtp['host'] . ':' . (int) $smtp['port'];

    $context = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true]]);
    $socket  = @stream_socket_client($remote, $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $context);
    if (!$socket) {
        throw new RuntimeException("SMTP connect failed: {$errstr} ({$errno})");
    }
    stream_set_timeout($socket, $timeout);

    $hostname = preg_replace('/[^a-z0-9.\-]/i', '', $_SERVER['SERVER_NAME'] ?? '') ?: 'localhost';

    try {
        smtp_expect($socket, 220);
        smtp_command($socket, "EHLO {$hostname}", 250);

        if ($secure === 'tls') {
            smtp_command($socket, 'STARTTLS', 220);
            if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                throw new RuntimeException('SMTP STARTTLS failed');
            }
            smtp_command($socket, "EHLO {$hostname}", 250);
        }

        if (($smtp['username'] ?? '') !== '') {
            smtp_command($socket, 'AUTH LOGIN', 334);
            smtp_command($socket, base64_encode($smtp['username']), 334);
            smtp_command($socket, base64_encode($smtp['password']), 235, true);
        }

        smtp_command($socket, "MAIL FROM:<{$from}>", 250);
        smtp_command($socket, "RCPT TO:<{$to}>", [250, 251]);
        smtp_command($socket, 'DATA', 354);

        $message = implode("\r\n", array_merge($headers, ['To: ' . $toHeader, 'Subject: ' . $subject])) . "\r\n\r\n" . $body;
        // Dot-stuffing: a line starting with "." must be doubled.
        $message = preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $message));
        fwrite($socket, $message . "\r\n.\r\n");
        smtp_expect($socket, 250);

        smtp_command($socket, 'QUIT', 221);
    } finally {
        fclose($socket);
    }
}

/** @param int|int[] $expect */
function smtp_command($socket, string $command, $expect, bool $secret = false): string
{
    fwrite($socket, $command . "\r\n");
    try {
        return smtp_expect($socket, $expect);
    } catch (RuntimeException $e) {
        throw new RuntimeException(($secret ? '[credentials]' : explode(' ', $command)[0]) . ' -> ' . $e->getMessage());
    }
}

/** @param int|int[] $expect */
function smtp_expect($socket, $expect): string
{
    $response = '';
    while (($line = fgets($socket, 515)) !== false) {
        $response .= $line;
        // The last line of a reply has a space after the code ("250 OK"), others a dash ("250-SIZE").
        if (isset($line[3]) && $line[3] === ' ') {
            break;
        }
    }
    $code = (int) substr($response, 0, 3);
    if (!in_array($code, (array) $expect, true)) {
        throw new RuntimeException('SMTP error: ' . trim($response ?: 'no response'));
    }
    return $response;
}
