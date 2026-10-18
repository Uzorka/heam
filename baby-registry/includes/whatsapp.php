<?php
/**
 * WhatsApp sending through Meta's WhatsApp Cloud API or Twilio.
 * With provider 'none' nothing is sent automatically; the admin dashboard
 * offers a click-to-chat link instead (see whatsapp_click_link()).
 */

declare(strict_types=1);

function whatsapp_enabled(): bool
{
    return in_array(registry_config()['whatsapp']['provider'] ?? 'none', ['meta', 'twilio'], true);
}

/**
 * @param string   $type   'confirmation' | 'reminder' | 'followup' | 'thankyou'
 * @param string[] $params Template parameters, in order (Meta).
 * @param string   $text   The full message (Twilio).
 * @return array{0: bool, 1: string}
 */
function send_whatsapp(string $phoneDigits, string $type, array $params, string $text): array
{
    $wa = registry_config()['whatsapp'];
    if ($phoneDigits === '') {
        return [false, 'No phone number'];
    }

    return match ($wa['provider'] ?? 'none') {
        'meta'   => whatsapp_meta($wa['meta'], $phoneDigits, $type, $params),
        'twilio' => whatsapp_twilio($wa['twilio'], $phoneDigits, $text),
        default  => [false, 'WhatsApp provider not configured'],
    };
}

function whatsapp_meta(array $meta, string $to, string $type, array $params): array
{
    $template = $meta['templates'][$type] ?? '';
    if ($template === '' || $meta['access_token'] === '' || $meta['phone_number_id'] === '') {
        return [false, 'Meta WhatsApp settings incomplete'];
    }

    $payload = [
        'messaging_product' => 'whatsapp',
        'to'                => $to,
        'type'              => 'template',
        'template'          => [
            'name'       => $template,
            'language'   => ['code' => $meta['language']],
            'components' => [[
                'type'       => 'body',
                'parameters' => array_map(
                    // Template parameters may not contain new lines, tabs or 4+ spaces.
                    static fn($p) => ['type' => 'text', 'text' => trim(preg_replace('/\s+/', ' ', (string) $p))],
                    $params
                ),
            ]],
        ],
    ];

    $url = 'https://graph.facebook.com/' . $meta['api_version'] . '/' . rawurlencode($meta['phone_number_id']) . '/messages';
    return http_post($url, json_encode($payload), [
        'Authorization: Bearer ' . $meta['access_token'],
        'Content-Type: application/json',
    ]);
}

function whatsapp_twilio(array $tw, string $to, string $text): array
{
    if ($tw['account_sid'] === '' || $tw['auth_token'] === '' || $tw['from_number'] === '') {
        return [false, 'Twilio settings incomplete'];
    }

    $url  = 'https://api.twilio.com/2010-04-01/Accounts/' . rawurlencode($tw['account_sid']) . '/Messages.json';
    $body = http_build_query([
        'From' => 'whatsapp:' . $tw['from_number'],
        'To'   => 'whatsapp:+' . $to,
        'Body' => $text,
    ]);

    return http_post($url, $body, [
        'Authorization: Basic ' . base64_encode($tw['account_sid'] . ':' . $tw['auth_token']),
        'Content-Type: application/x-www-form-urlencoded',
    ]);
}

/** @return array{0: bool, 1: string} */
function http_post(string $url, string $body, array $headers): array
{
    if (!function_exists('curl_init')) {
        return [false, 'PHP cURL extension is not enabled'];
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    $response = (string) curl_exec($ch);
    $status   = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($error !== '') {
        return [false, 'HTTP error: ' . $error];
    }
    $ok = $status >= 200 && $status < 300;
    if (!$ok) {
        error_log("Registry WhatsApp error ({$status}): {$response}");
    }
    return [$ok, "HTTP {$status}: " . mb_substr($response, 0, 300)];
}

/** wa.me link that opens WhatsApp with the message already typed in. */
function whatsapp_click_link(string $phoneDigits, string $text): string
{
    return 'https://wa.me/' . rawurlencode($phoneDigits) . '?text=' . rawurlencode($text);
}

/**
 * Sends a test WhatsApp message from the admin settings page.
 * Meta: uses the "hello_world" template every new WhatsApp Business account has.
 * @return array{0: bool, 1: string}
 */
function whatsapp_test(string $phoneDigits): array
{
    $wa = registry_config()['whatsapp'];
    if ($phoneDigits === '') {
        return [false, 'Please enter a valid WhatsApp number.'];
    }
    if (($wa['provider'] ?? 'none') === 'meta') {
        $meta = $wa['meta'];
        if ($meta['access_token'] === '' || $meta['phone_number_id'] === '') {
            return [false, 'Meta WhatsApp settings incomplete (access_token / phone_number_id).'];
        }
        $payload = [
            'messaging_product' => 'whatsapp',
            'to'                => $phoneDigits,
            'type'              => 'template',
            'template'          => ['name' => 'hello_world', 'language' => ['code' => 'en_US']],
        ];
        $url = 'https://graph.facebook.com/' . $meta['api_version'] . '/' . rawurlencode($meta['phone_number_id']) . '/messages';
        return http_post($url, json_encode($payload), [
            'Authorization: Bearer ' . $meta['access_token'],
            'Content-Type: application/json',
        ]);
    }
    if (($wa['provider'] ?? 'none') === 'twilio') {
        return whatsapp_twilio($wa['twilio'], $phoneDigits, 'Test message from your baby registry. WhatsApp is working! 🎉');
    }
    return [false, "WhatsApp provider is 'none', so nothing is sent automatically."];
}
