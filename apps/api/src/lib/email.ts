import nodemailer from 'nodemailer'
import { log } from '../index'

let _transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
      secure: false,
      ignoreTLS: true,
    })
  }
  return _transporter
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const from = process.env.SMTP_FROM ?? 'noreply@cslate.local'
  const verifyUrl = `${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/api/v1/auth/verify?token=${token}`

  await getTransporter().sendMail({
    from,
    to: email,
    subject: 'Verify your CSlate account',
    text: `Click to verify your account: ${verifyUrl}`,
    html: `<p>Click to verify your account: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
  })
}

export async function sendRecoveryEmail(email: string, token: string): Promise<void> {
  const from = process.env.SMTP_FROM ?? 'noreply@cslate.local'
  const recoverUrl = `${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/api/v1/auth/recover/confirm?token=${token}`

  await getTransporter().sendMail({
    from,
    to: email,
    subject: 'Recover your CSlate API key',
    text: `Click to recover your API key: ${recoverUrl}`,
    html: `<p>Click to recover your API key: <a href="${recoverUrl}">${recoverUrl}</a></p>`,
  })
}
