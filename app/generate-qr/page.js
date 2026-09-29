'use client';

import { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';

const SHOP_NAME = 'สี่ นม นัว เวอร์';
const QR_ENDPOINT = 'https://api.qrserver.com/v1/create-qr-code/';

function minutesSince(iso, nowMs) {
  const diff = nowMs - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / 60000));
}

export default function GenerateQrPage() {
  const [tableNumber, setTableNumber] = useState('');
  const [customerCount, setCustomerCount] = useState('1');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // session เก่าที่ยังเปิดค้างอยู่ (แสดงกล่องเตือน)
  const [existing, setExisting] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmNow, setConfirmNow] = useState(0);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [notice, setNotice] = useState('');

  // ผลลัพธ์หลังสร้าง session ใหม่
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  function parseForm() {
    const table = Number(tableNumber);
    const count = Number(customerCount);
    if (tableNumber === '' || !Number.isInteger(table) || table < 1) {
      return { error: 'กรุณากรอกเลขโต๊ะเป็นตัวเลข (1 ขึ้นไป)' };
    }
    if (customerCount === '' || !Number.isInteger(count) || count < 1) {
      return { error: 'กรุณากรอกจำนวนลูกค้าอย่างน้อย 1 คน' };
    }
    return { table, count };
  }

  async function handleOpenTable(e) {
    e.preventDefault();
    setError('');
    setNotice('');

    if (!isSupabaseConfigured) {
      setError(
        'ยังไม่ได้ตั้งค่า Supabase: เพิ่ม NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_ANON_KEY แล้ว Redeploy'
      );
      return;
    }

    const parsed = parseForm();
    if (parsed.error) {
      setError(parsed.error);
      return;
    }

    setLoading(true);
    try {
      // 1) เช็คว่าโต๊ะนี้มี session เปิดค้างอยู่หรือไม่
      const { data: openRows, error: findError } = await supabase
        .from('sessions')
        .select('id, customer_count, created_at')
        .eq('table_number', parsed.table)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

      if (findError) throw findError;

      if (openRows && openRows.length > 0) {
        setExisting({ ...openRows[0], table_number: parsed.table });
        return;
      }

      // 2) ไม่มี -> สร้าง session ใหม่
      const { error: insertError } = await supabase.from('sessions').insert({
        table_number: parsed.table,
        customer_count: parsed.count,
        status: 'open',
      });

      if (insertError) throw insertError;

      const url = `${window.location.origin}/order/${parsed.table}`;
      setResult({ table: parsed.table, count: parsed.count, url });
      setCopied(false);
    } catch (err) {
      console.error(err);
      setError(`เกิดข้อผิดพลาด: ${err.message || 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้'}`);
    } finally {
      setLoading(false);
    }
  }

  function openConfirm() {
    setCloseError('');
    setConfirmNow(Date.now());
    setShowConfirm(true);
  }

  async function handleConfirmClose() {
    if (!existing || closing) return;
    setClosing(true);
    setCloseError('');
    try {
      // update เฉพาะแถวนี้ และเฉพาะตอนที่ยังเป็น 'open' (กันการกดซ้ำซ้อน)
      const { data: updated, error: updateError } = await supabase
        .from('sessions')
        .update({ status: 'closed' })
        .eq('id', existing.id)
        .eq('status', 'open')
        .select('id');

      if (updateError) throw updateError;

      if (!updated || updated.length === 0) {
        // ไม่มีแถวถูกแก้ไข: อาจมีคนปิดไปก่อนแล้ว หรือถูกบล็อกโดยสิทธิ์ (RLS)
        const { data: check, error: checkError } = await supabase
          .from('sessions')
          .select('status')
          .eq('id', existing.id)
          .limit(1);
        if (checkError) throw checkError;
        if (check && check.length > 0 && check[0].status === 'open') {
          throw new Error('ปิดโต๊ะไม่สำเร็จ (ตรวจสอบสิทธิ์ update ของตาราง sessions)');
        }
        setNotice('ออเดอร์เดิมถูกปิดไปก่อนหน้านี้แล้ว กด "เปิดโต๊ะ" ได้เลย');
      } else {
        setNotice('ปิดโต๊ะเดิมเรียบร้อย กด "เปิดโต๊ะ" เพื่อสร้างออเดอร์ใหม่ได้เลย');
      }

      setShowConfirm(false);
      setExisting(null);
    } catch (err) {
      console.error(err);
      setCloseError(err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setClosing(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
    } catch {
      const el = document.createElement('textarea');
      el.value = result.url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleNext() {
    setTableNumber('');
    setCustomerCount('1');
    setResult(null);
    setExisting(null);
    setShowConfirm(false);
    setError('');
    setNotice('');
    setCopied(false);
  }

  function handleTableChange(value) {
    setTableNumber(value);
    // เปลี่ยนเลขโต๊ะแล้ว กล่องเตือนของโต๊ะเดิมไม่เกี่ยวแล้ว
    if (existing) setExisting(null);
    if (notice) setNotice('');
  }

  const qrSrc = result
    ? `${QR_ENDPOINT}?size=300x300&data=${encodeURIComponent(result.url)}`
    : '';

  return (
    <main className="gq-page">
      <style>{css}</style>

      <h1 className="gq-title">เปิดโต๊ะ</h1>

      {result ? (
        <section className="gq-card gq-result" aria-live="polite">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="gq-qr"
            src={qrSrc}
            alt={`QR Code สำหรับโต๊ะ ${result.table}`}
            width={300}
            height={300}
          />
          <p className="gq-summary">
            ร้าน {SHOP_NAME} · โต๊ะ {result.table} · ลูกค้า {result.count} ท่าน
          </p>
          <div className="gq-linkrow">
            <span className="gq-url">{result.url}</span>
            <button type="button" className="gq-btn gq-btn-small" onClick={handleCopy}>
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
            </button>
          </div>
          <button type="button" className="gq-btn gq-btn-primary" onClick={handleNext}>
            เปิดโต๊ะถัดไป
          </button>
        </section>
      ) : (
        <form className="gq-card" onSubmit={handleOpenTable} noValidate>
          <label className="gq-field">
            <span>เลขโต๊ะ</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={tableNumber}
              onChange={(e) => handleTableChange(e.target.value)}
              autoFocus
            />
          </label>
          <label className="gq-field">
            <span>จำนวนลูกค้า (คน)</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={customerCount}
              onChange={(e) => setCustomerCount(e.target.value)}
            />
          </label>

          {error && (
            <p className="gq-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="gq-notice" role="status">
              {notice}
            </p>
          )}

          {existing && (
            <div className="gq-warning" role="alert">
              <p className="gq-warning-text">
                โต๊ะ {existing.table_number} กำลังมีลูกค้านั่งอยู่ (ออเดอร์ยังไม่ถูกปิด)
              </p>
              <button type="button" className="gq-btn gq-btn-warn" onClick={openConfirm}>
                ปิดออเดอร์/ปิดโต๊ะเดิม
              </button>
            </div>
          )}

          <button type="submit" className="gq-btn gq-btn-primary" disabled={loading}>
            {loading ? 'กำลังตรวจสอบ...' : 'เปิดโต๊ะ'}
          </button>
        </form>
      )}

      {showConfirm && existing && (
        <div className="gq-overlay">
          <div
            className="gq-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gq-dialog-title"
          >
            <h2 id="gq-dialog-title" className="gq-dialog-title">
              ยืนยันปิดโต๊ะเดิม
            </h2>
            <dl className="gq-dl">
              <div>
                <dt>โต๊ะ</dt>
                <dd>{existing.table_number}</dd>
              </div>
              <div>
                <dt>ลูกค้า (คน)</dt>
                <dd>{existing.customer_count}</dd>
              </div>
            </dl>
            <p className="gq-elapsed">
              เปิดโต๊ะมาแล้ว {minutesSince(existing.created_at, confirmNow)} นาที
            </p>
            {closeError && (
              <p className="gq-error" role="alert">
                {closeError}
              </p>
            )}
            <div className="gq-dialog-actions">
              <button
                type="button"
                className="gq-btn"
                onClick={() => setShowConfirm(false)}
                disabled={closing}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="gq-btn gq-btn-danger"
                onClick={handleConfirmClose}
                disabled={closing}
              >
                {closing ? 'กำลังปิด...' : 'ยืนยันปิดโต๊ะเดิม'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const css = `
.gq-page {
  --ink: #4a3221;
  --muted: #8a7159;
  --line: #e6d5bc;
  --bg: #fbf3e4;
  --surface: #fffdf8;
  --primary: #7a4a2a;
  --accent: #f4b77a;
  --warn-bg: #ffe8d6;
  --warn-line: #d9480f;
  --warn-ink: #7c2d06;
  --danger: #b42318;
  min-height: 100vh;
  padding: 24px 16px 48px;
  background: var(--bg);
  color: var(--ink);
  font-family: "Noto Sans Thai", "Sarabun", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 22px;
  line-height: 1.5;
}
.gq-page * { box-sizing: border-box; }
.gq-title { max-width: 520px; margin: 0 auto 16px; font-size: 36px; font-weight: 700; }
.gq-card {
  max-width: 520px; margin: 0 auto; padding: 24px;
  background: var(--surface); border: 1px solid var(--line); border-top: 8px solid var(--accent);
  border-radius: 14px; display: flex; flex-direction: column; gap: 20px;
}
.gq-field { display: flex; flex-direction: column; gap: 6px; font-weight: 600; }
.gq-field input {
  width: 100%; height: 64px; padding: 0 16px;
  font: inherit; font-size: 30px; color: var(--ink);
  border: 2px solid var(--line); border-radius: 10px; background: #fff;
}
.gq-field input:focus-visible { outline: 3px solid var(--accent); outline-offset: 1px; border-color: var(--primary); }
.gq-btn {
  min-height: 60px; padding: 0 24px; font: inherit; font-weight: 700;
  color: var(--ink); background: #fff; border: 2px solid var(--line); border-radius: 10px; cursor: pointer;
}
.gq-btn:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.gq-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.gq-btn-primary { color: #fff8ee; background: var(--primary); border-color: var(--primary); }
.gq-btn-warn { color: #fff; background: var(--warn-line); border-color: var(--warn-line); }
.gq-btn-danger { color: #fff; background: var(--danger); border-color: var(--danger); }
.gq-btn-small { min-height: 44px; padding: 0 16px; font-size: 18px; white-space: nowrap; }
.gq-error { margin: 0; color: var(--danger); font-weight: 600; }
.gq-notice { margin: 0; padding: 12px 16px; background: #eef4e2; border-left: 6px solid #5b7f2b; color: #2f4a10; font-weight: 600; }
.gq-warning {
  display: flex; flex-direction: column; gap: 14px; padding: 18px;
  background: var(--warn-bg); border: 3px solid var(--warn-line); border-radius: 12px;
}
.gq-warning-text { margin: 0; color: var(--warn-ink); font-weight: 700; }
.gq-result { align-items: center; text-align: center; }
.gq-result .gq-btn { width: 100%; }
.gq-qr { width: 300px; max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
.gq-summary { margin: 0; font-size: 26px; font-weight: 700; }
.gq-linkrow { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; background: var(--bg); border-radius: 10px; }
.gq-url { flex: 1; min-width: 0; font-size: 18px; color: var(--muted); word-break: break-all; text-align: left; }
.gq-overlay {
  position: fixed; inset: 0; z-index: 50; padding: 16px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(74, 50, 33, 0.65);
}
.gq-dialog {
  width: 100%; max-width: 460px; padding: 24px; background: #fff;
  border: 4px solid var(--danger); border-radius: 14px;
  display: flex; flex-direction: column; gap: 16px;
}
.gq-dialog-title { margin: 0; color: var(--danger); font-size: 28px; }
.gq-dl { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0; }
.gq-dl div { padding: 10px; background: var(--bg); border-radius: 10px; text-align: center; }
.gq-dl dt { font-size: 16px; color: var(--muted); }
.gq-dl dd { margin: 0; font-size: 32px; font-weight: 700; }
.gq-elapsed { margin: 0; font-size: 24px; font-weight: 700; }
.gq-dialog-actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; }
@media (max-width: 420px) {
  .gq-page { font-size: 20px; }
  .gq-title { font-size: 30px; }
  .gq-dialog-actions { grid-template-columns: 1fr; }
}
`;
