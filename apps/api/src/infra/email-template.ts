const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface EmailTemplateInput {
  heading: string;
  /** Each entry becomes a paragraph. Plain text; HTML is escaped. */
  bodyLines: string[];
  button?: { label: string; url: string };
  /** Small print under the button (e.g. expiry note). */
  footerNote?: string;
}

/**
 * Branded transactional email. Table-based layout with inline styles only, so
 * it renders in Outlook/Gmail/Apple Mail. Light theme to match the product:
 * slate background, white card, cyan accent, mono uppercase brand mark.
 */
export function renderEmail({ heading, bodyLines, button, footerNote }: EmailTemplateInput): string {
  const paragraphs = bodyLines
    .map(
      (line) =>
        `<p style="margin:0 0 14px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:#334155;">${escapeHtml(line)}</p>`,
    )
    .join('\n');

  const buttonHtml = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 6px 0;">
        <tr>
          <td align="center" bgcolor="#0891b2" style="border-radius:8px;">
            <a href="${escapeHtml(button.url)}" target="_blank"
               style="display:inline-block;padding:12px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">
              ${escapeHtml(button.label)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 14px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#94a3b8;word-break:break-all;">
        Or copy this link: ${escapeHtml(button.url)}
      </p>`
    : '';

  const footerNoteHtml = footerNote
    ? `<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#94a3b8;">${escapeHtml(footerNote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
          <tr>
            <td style="padding:0 4px 14px 4px;">
              <span style="font-family:'Courier New',Courier,monospace;font-size:13px;font-weight:bold;letter-spacing:4px;color:#0f172a;">KHR</span>
              <span style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:2px;color:#64748b;">&nbsp;&middot;&nbsp;PEOPLEFLOW HR</span>
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff;border:1px solid #e2e8f0;border-top:3px solid #06b6d4;border-radius:10px;padding:28px 28px 22px 28px;">
              <h1 style="margin:0 0 16px 0;font-family:Helvetica,Arial,sans-serif;font-size:19px;line-height:26px;color:#0f172a;">${escapeHtml(heading)}</h1>
              ${paragraphs}
              ${buttonHtml}
              ${footerNoteHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 4px 0 4px;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:17px;color:#94a3b8;">
                You received this email because of activity on a PeopleFlow HR workspace.
                If this wasn't you, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
