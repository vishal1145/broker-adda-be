/**
 * Email template generator with header, footer, and proper message formatting
 * @param {Object} options - Email template options
 * @param {String} options.title - Email title/subject
 * @param {String} options.message - Main message content
 * @param {String} options.userName - Recipient's name (optional)
 * @returns {Object} Object with text and html email content
 */
export const generateEmailTemplate = ({ title, message, userName = 'User' }) => {
  const companyName = 'Brokergully';
  const companyEmail = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@brokergully.com';
  
  // Convert line breaks to HTML
  const htmlMessage = message.replace(/\n/g, '<br>');
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
      <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f4f4f4;">
        <tr>
          <td style="padding: 20px 0;">
            <table role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #14532d 0%, #166534 100%); padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">${companyName}</h1>
                  <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0 0; font-size: 14px;">Your Trusted Real Estate Partner</p>
                </td>
              </tr>
              
              <!-- Content -->
              <tr>
                <td style="padding: 40px 30px;">
                  <h2 style="color: #14532d; margin: 0 0 20px 0; font-size: 24px; font-weight: 600; line-height: 1.3;">${title}</h2>
                  
                  <p style="color: #555555; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hello ${userName},</p>
                  
                  <div style="color: #555555; font-size: 16px; line-height: 1.8; margin: 20px 0;">
                    ${htmlMessage}
                  </div>
                  
                  <p style="color: #555555; margin: 30px 0 0 0; font-size: 16px; line-height: 1.6;">Best regards,<br><strong style="color: #14532d;">${companyName} Team</strong></p>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f9fa; padding: 30px 20px; text-align: center; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
                  <p style="color: #6c757d; margin: 0 0 10px 0; font-size: 14px; line-height: 1.6;">
                    This email was sent to you by ${companyName}. If you have any questions, please contact us at 
                    <a href="mailto:${companyEmail}" style="color: #14532d; text-decoration: none; font-weight: 500;">${companyEmail}</a>
                  </p>
                  <p style="color: #adb5bd; margin: 15px 0 0 0; font-size: 12px; line-height: 1.6;">
                    © ${new Date().getFullYear()} ${companyName}. All rights reserved.
                  </p>
                  <p style="color: #adb5bd; margin: 10px 0 0 0; font-size: 12px; line-height: 1.6;">
                    You are receiving this email because you have an account with ${companyName}.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
  
  // Plain text version
  const text = `
${companyName}
${title}

Hello ${userName},

${message}

Best regards,
${companyName} Team

---
This email was sent to you by ${companyName}. If you have any questions, please contact us at ${companyEmail}.

© ${new Date().getFullYear()} ${companyName}. All rights reserved.
You are receiving this email because you have an account with ${companyName}.
  `.trim();
  
  return { text, html };
};

