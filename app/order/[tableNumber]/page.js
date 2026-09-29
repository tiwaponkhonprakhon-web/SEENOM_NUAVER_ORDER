'use client';

import { use, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../../lib/supabaseClient';

const SHOP_NAME = 'สี่ นม นัว เวอร์';
const MAX_PER_ITEM = 5;
const MAX_PER_SUBMIT = 10;

const baht = (n) => `฿${Number(n || 0).toLocaleString('th-TH')}`;

export default function OrderPage({ params }) {
  // params เป็น Promise เสมอ ต้อง unwrap ด้วย use()
  const resolvedParams = use(params);
  const tableNumber = resolvedParams.tableNumber;
  const tableNo = Number(tableNumber);
  const tableValid = Number.isInteger(tableNo) && tableNo >= 1;

  // loading | notopen | error | ready | thanks
  const [phase, setPhase] = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [session, setSession] = useState(null);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [activeCat, setActiveCat] = useState(null);

  const [cart, setCart] = useState({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [toast, setToast] = useState('');

  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutTotal, setCheckoutTotal] = useState(0);
  const [checkoutOrders, setCheckoutOrders] = useState(0);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setPhase('loading');

      if (!isSupabaseConfigured) {
        setErrorMsg('ยังไม่ได้ตั้งค่า Supabase (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)');
        setPhase('error');
        return;
      }
      if (!tableValid) {
        setPhase('notopen');
        return;
      }

      try {
        const { data: sess, error: sessError } = await supabase
          .from('sessions')
          .select('id')
          .eq('table_number', tableNo)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(1);
        if (sessError) throw sessError;
        if (cancelled) return;

        if (!sess || sess.length === 0) {
          setPhase('notopen');
          return;
        }

        const [catRes, itemRes] = await Promise.all([
          supabase
            .from('menu_categories')
            .select('id, name, sort_order')
            .order('sort_order', { ascending: true }),
          supabase
            .from('menu_items')
            .select('id, category_id, name, price, is_available')
            .order('id', { ascending: true }),
        ]);
        if (catRes.error) throw catRes.error;
        if (itemRes.error) throw itemRes.error;
        if (cancelled) return;

        const cats = catRes.data || [];
        setSession(sess[0]);
        setCategories(cats);
        setItems(itemRes.data || []);
        setActiveCat(cats.length > 0 ? cats[0].id : null);
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setErrorMsg(err.message || 'ไม่สามารถโหลดข้อมูลได้');
        setPhase('error');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tableNo, tableValid, reloadKey]);

  const totalCount = Object.values(cart).reduce((s, q) => s + q, 0);
  const totalPrice = items.reduce(
    (s, it) => s + (cart[it.id] || 0) * Number(it.price || 0),
    0
  );

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(''), 3500);
  }

  function changeQty(item, delta) {
    setSendError('');
    setCart((prev) => {
      const cur = prev[item.id] || 0;
      const sum = Object.values(prev).reduce((s, q) => s + q, 0);
      if (delta > 0 && (cur >= MAX_PER_ITEM || sum >= MAX_PER_SUBMIT)) return prev;
      const next = Math.max(0, cur + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[item.id];
      else copy[item.id] = next;
      return copy;
    });
  }

  async function isSessionOpen() {
    const { data, error } = await supabase
      .from('sessions')
      .select('status')
      .eq('id', session.id)
      .limit(1);
    if (error) throw error;
    return Boolean(data && data.length > 0 && data[0].status === 'open');
  }

  async function handleSend() {
    if (sending || totalCount === 0 || !session) return;
    setSending(true);
    setSendError('');
    try {
      // กันกรณีพนักงานปิดโต๊ะไปแล้วระหว่างที่ลูกค้าเลือกอาหาร
      if (!(await isSessionOpen())) {
        setPhase('notopen');
        return;
      }

      const orderItems = items
        .filter((it) => cart[it.id] > 0)
        .map((it) => ({
          item_id: it.id,
          name: it.name,
          price: Number(it.price),
          quantity: cart[it.id],
        }));

      const { error } = await supabase.from('orders').insert({
        session_id: session.id,
        table_number: tableNo,
        items: orderItems,
        total_price: totalPrice,
        status: 'received',
      });
      if (error) throw error;

      setCart({});
      showToast('✅ ส่งออเดอร์เรียบร้อยแล้ว');
    } catch (err) {
      console.error(err);
      setSendError(`ส่งออเดอร์ไม่สำเร็จ: ${err.message || 'กรุณาลองใหม่'}`);
    } finally {
      setSending(false);
    }
  }

  async function openCheckout() {
    if (!session) return;
    setCheckoutError('');
    setCloseError('');
    setShowCheckout(true);
    setCheckoutLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('total_price')
        .eq('session_id', session.id);
      if (error) throw error;
      const rows = data || [];
      setCheckoutTotal(rows.reduce((s, r) => s + Number(r.total_price || 0), 0));
      setCheckoutOrders(rows.length);
    } catch (err) {
      console.error(err);
      setCheckoutError(`คำนวณยอดไม่สำเร็จ: ${err.message || 'กรุณาลองใหม่'}`);
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function handleConfirmCheckout() {
    if (!session || closing) return;
    setClosing(true);
    setCloseError('');
    try {
      // update เฉพาะ session นี้ และเฉพาะตอนที่ยังเป็น 'open'
      const { data: updated, error: updateError } = await supabase
        .from('sessions')
        .update({ status: 'closed' })
        .eq('id', session.id)
        .eq('status', 'open')
        .select('id');
      if (updateError) throw updateError;

      if (!updated || updated.length === 0) {
        // ไม่มีแถวถูกแก้ไข: อาจถูกปิดไปแล้ว หรือถูกบล็อกโดยสิทธิ์ (RLS)
        if (await isSessionOpen()) {
          throw new Error('ปิดโต๊ะไม่สำเร็จ กรุณาแจ้งพนักงาน');
        }
      }

      setShowCheckout(false);
      setCart({});
      setPhase('thanks');
    } catch (err) {
      console.error(err);
      setCloseError(err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setClosing(false);
    }
  }

  // ---------- หน้าจอเต็มจอแบบต่างๆ ----------
  if (phase === 'loading') {
    return (
      <main className="od-page od-center">
        <style>{css}</style>
        <p className="od-big">กำลังโหลดเมนู...</p>
      </main>
    );
  }

  if (phase === 'notopen') {
    return (
      <main className="od-page od-center">
        <style>{css}</style>
        <p className="od-big">❌ โต๊ะนี้ยังไม่เปิดใช้งาน กรุณาแจ้งพนักงานหน้าร้าน</p>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="od-page od-center">
        <style>{css}</style>
        <p className="od-big">โหลดข้อมูลไม่สำเร็จ</p>
        <p className="od-small">{errorMsg}</p>
        <button
          type="button"
          className="od-btn od-btn-primary"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          ลองใหม่
        </button>
      </main>
    );
  }

  if (phase === 'thanks') {
    return (
      <main className="od-page od-center">
        <style>{css}</style>
        <p className="od-big">🍼 {SHOP_NAME} - ขอบคุณที่ใช้บริการครับ! ❤️</p>
      </main>
    );
  }

  // ---------- หน้าสั่งอาหาร ----------
  const visibleItems = items.filter((it) => it.category_id === activeCat);

  return (
    <main className="od-page">
      <style>{css}</style>

      {toast && (
        <div className="od-toast" role="status">
          {toast}
        </div>
      )}

      <header className="od-top">
        <div className="od-top-row">
          <div>
            <div className="od-shop">{SHOP_NAME}</div>
            <div className="od-table">โต๊ะ {tableNo}</div>
          </div>
          <button type="button" className="od-bill" onClick={openCheckout}>
            เรียกเก็บเงิน
          </button>
        </div>
        <div className="od-tabs" role="tablist">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === activeCat}
              className={c.id === activeCat ? 'od-tab od-tab-on' : 'od-tab'}
              onClick={() => setActiveCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </header>

      <p className="od-hint">
        สั่งได้สูงสุด {MAX_PER_ITEM} ชิ้นต่อเมนู และ {MAX_PER_SUBMIT} ชิ้นต่อการส่ง 1 ครั้ง
      </p>

      {categories.length === 0 ? (
        <p className="od-empty">ยังไม่มีเมนูในระบบ</p>
      ) : visibleItems.length === 0 ? (
        <p className="od-empty">ยังไม่มีเมนูในหมวดนี้</p>
      ) : (
        <ul className="od-list">
          {visibleItems.map((it) => {
            const qty = cart[it.id] || 0;
            const unavailable = it.is_available === false;
            return (
              <li key={it.id} className="od-item">
                <div className="od-info">
                  <div className="od-name">{it.name}</div>
                  <div className="od-price">{baht(it.price)}</div>
                </div>
                {unavailable ? (
                  <span className="od-soldout">หมด</span>
                ) : (
                  <div className="od-stepper">
                    <button
                      type="button"
                      className="od-step"
                      aria-label={`ลด ${it.name}`}
                      disabled={qty === 0}
                      onClick={() => changeQty(it, -1)}
                    >
                      −
                    </button>
                    <span className="od-qty">{qty}</span>
                    <button
                      type="button"
                      className="od-step od-step-plus"
                      aria-label={`เพิ่ม ${it.name}`}
                      disabled={qty >= MAX_PER_ITEM || totalCount >= MAX_PER_SUBMIT}
                      onClick={() => changeQty(it, 1)}
                    >
                      +
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {totalCount > 0 && (
        <div className="od-cartwrap">
          {sendError && (
            <p className="od-senderror" role="alert">
              {sendError}
            </p>
          )}
          <div className="od-cartbar">
            <div>
              <div className="od-cart-count">🛒 {totalCount} ชิ้น</div>
              <div className="od-cart-total">{baht(totalPrice)}</div>
            </div>
            <button
              type="button"
              className="od-send"
              onClick={handleSend}
              disabled={sending}
            >
              {sending ? 'กำลังส่ง...' : 'ส่งออเดอร์'}
            </button>
          </div>
        </div>
      )}

      {showCheckout && (
        <div className="od-overlay">
          <div
            className="od-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="od-dialog-title"
          >
            <h2 id="od-dialog-title" className="od-dialog-title">
              เรียกเก็บเงิน · โต๊ะ {tableNo}
            </h2>

            {checkoutLoading ? (
              <p className="od-small">กำลังคำนวณยอด...</p>
            ) : checkoutError ? (
              <p className="od-error" role="alert">
                {checkoutError}
              </p>
            ) : (
              <>
                <p className="od-total-label">ยอดรวมทั้งโต๊ะ</p>
                <p className="od-total">{baht(checkoutTotal)}</p>
                <p className="od-small">จากออเดอร์ที่ส่งแล้ว {checkoutOrders} ครั้ง</p>
                {totalCount > 0 && (
                  <p className="od-warn">
                    มี {totalCount} ชิ้นในตะกร้าที่ยังไม่ได้ส่ง จะไม่ถูกนับในยอดนี้
                  </p>
                )}
                <p className="od-small">
                  เมื่อยืนยันแล้ว โต๊ะจะถูกปิดและสั่งอาหารเพิ่มไม่ได้
                </p>
              </>
            )}

            {closeError && (
              <p className="od-error" role="alert">
                {closeError}
              </p>
            )}

            <div className="od-dialog-actions">
              <button
                type="button"
                className="od-btn"
                onClick={() => setShowCheckout(false)}
                disabled={closing}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="od-btn od-btn-primary"
                onClick={handleConfirmCheckout}
                disabled={closing || checkoutLoading || Boolean(checkoutError)}
              >
                {closing ? 'กำลังปิดโต๊ะ...' : 'ยืนยันเช็คบิล / ปิดโต๊ะ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const css = `
.od-page {
  --ink: #5a3a22;
  --muted: #94795f;
  --line: #ecd9b8;
  --bg: #fff6e5;
  --surface: #fffdf7;
  --yellow: #ffe9a8;
  --brown: #7a4a2a;
  --orange: #d9651b;
  --gold: #ffd166;
  --danger: #b42318;
  min-height: 100vh;
  padding-bottom: 150px;
  background: var(--bg);
  color: var(--ink);
  font-family: "Noto Sans Thai", "Sarabun", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 20px;
  line-height: 1.45;
}
.od-page * { box-sizing: border-box; }
.od-center {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 16px; padding: 24px; text-align: center;
}
.od-big { margin: 0; font-size: 30px; font-weight: 700; line-height: 1.4; }
.od-small { margin: 0; font-size: 17px; color: var(--muted); }
.od-top {
  position: sticky; top: 0; z-index: 20;
  background: var(--yellow); border-bottom: 3px solid var(--orange);
  padding: 12px 16px 0;
}
.od-top-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 560px; margin: 0 auto; }
.od-shop { font-size: 22px; font-weight: 700; }
.od-table { font-size: 18px; color: var(--brown); font-weight: 600; }
.od-bill {
  min-height: 48px; padding: 0 16px; font: inherit; font-size: 18px; font-weight: 700;
  color: #fff8ee; background: var(--brown); border: 0; border-radius: 999px; cursor: pointer;
}
.od-tabs {
  display: flex; gap: 8px; max-width: 560px; margin: 10px auto 0;
  overflow-x: auto; padding-bottom: 10px; -webkit-overflow-scrolling: touch;
}
.od-tab {
  flex: 0 0 auto; min-height: 44px; padding: 0 18px; font: inherit; font-size: 18px; font-weight: 600;
  color: var(--ink); background: #fff8dc; border: 2px solid var(--line); border-radius: 999px; cursor: pointer;
  white-space: nowrap;
}
.od-tab-on { color: #fff8ee; background: var(--orange); border-color: var(--orange); }
.od-hint { max-width: 560px; margin: 12px auto 0; padding: 0 16px; font-size: 15px; color: var(--muted); }
.od-empty { max-width: 560px; margin: 32px auto; padding: 0 16px; text-align: center; color: var(--muted); }
.od-list { list-style: none; max-width: 560px; margin: 12px auto 0; padding: 0 16px; display: flex; flex-direction: column; gap: 12px; }
.od-item {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 16px; background: var(--surface); border: 2px solid var(--line); border-radius: 16px;
}
.od-info { min-width: 0; }
.od-name { font-size: 21px; font-weight: 700; }
.od-price { font-size: 19px; color: var(--orange); font-weight: 700; }
.od-stepper { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.od-step {
  width: 52px; height: 52px; font: inherit; font-size: 28px; font-weight: 700; line-height: 1;
  color: var(--brown); background: #fff; border: 2px solid var(--line); border-radius: 50%; cursor: pointer;
}
.od-step-plus { color: #fff; background: var(--orange); border-color: var(--orange); }
.od-step:disabled { opacity: 0.35; cursor: not-allowed; }
.od-qty { min-width: 28px; text-align: center; font-size: 24px; font-weight: 700; }
.od-soldout { flex: 0 0 auto; padding: 6px 14px; font-weight: 700; color: var(--muted); background: #f1e6d0; border-radius: 999px; }
.od-cartwrap { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; padding: 0 12px calc(12px + env(safe-area-inset-bottom, 0px)); }
.od-senderror { max-width: 560px; margin: 0 auto 8px; padding: 10px 14px; background: #fde8e6; color: var(--danger); border: 2px solid var(--danger); border-radius: 12px; font-weight: 600; }
.od-cartbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  max-width: 560px; margin: 0 auto; padding: 12px 14px 12px 20px;
  color: #fff8ee; background: var(--ink); border-radius: 20px; box-shadow: 0 6px 20px rgba(90, 58, 34, 0.35);
}
.od-cart-count { font-size: 18px; }
.od-cart-total { font-size: 26px; font-weight: 700; }
.od-send {
  min-height: 56px; padding: 0 24px; font: inherit; font-size: 20px; font-weight: 700;
  color: var(--ink); background: var(--gold); border: 0; border-radius: 14px; cursor: pointer;
}
.od-send:disabled { opacity: 0.6; cursor: not-allowed; }
.od-toast {
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 60;
  max-width: calc(100% - 24px); padding: 12px 20px; font-size: 19px; font-weight: 700;
  color: #234d12; background: #e9f5d6; border: 2px solid #6b9a2f; border-radius: 14px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
}
.od-overlay {
  position: fixed; inset: 0; z-index: 50; padding: 16px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(90, 58, 34, 0.6);
}
.od-dialog {
  width: 100%; max-width: 440px; padding: 24px; background: var(--surface);
  border: 4px solid var(--orange); border-radius: 20px;
  display: flex; flex-direction: column; gap: 10px; text-align: center;
}
.od-dialog-title { margin: 0; font-size: 24px; }
.od-total-label { margin: 8px 0 0; color: var(--muted); }
.od-total { margin: 0; font-size: 44px; font-weight: 700; color: var(--orange); }
.od-warn { margin: 0; padding: 10px 12px; background: #fff0d1; border-radius: 10px; color: #7c4a03; font-weight: 600; font-size: 17px; }
.od-error { margin: 0; color: var(--danger); font-weight: 600; }
.od-dialog-actions { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 8px; }
.od-btn {
  min-height: 56px; padding: 0 20px; font: inherit; font-size: 19px; font-weight: 700;
  color: var(--ink); background: #fff; border: 2px solid var(--line); border-radius: 14px; cursor: pointer;
}
.od-btn-primary { color: #fff8ee; background: var(--brown); border-color: var(--brown); }
.od-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.od-page button:focus-visible { outline: 3px solid var(--orange); outline-offset: 2px; }
`;
