'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
// ปรับ path ให้ตรงกับโปรเจกต์ของคุณ (ไฟล์ที่ export supabase client)
import { supabase } from '@/lib/supabaseClient';

// =====================================================================
// ตั้งค่าเมนูโซนบาร์ (แก้ตรงนี้เมื่อมีเมนูใหม่)
// ถ้า item มีฟิลด์ category จะเช็คจากหมวดก่อน ถ้าไม่มีจะเช็คจากคำในชื่อเมนู
// =====================================================================
const BAR_CATEGORIES = ['drink', 'drinks', 'beverage', 'bread', 'toast', 'เครื่องดื่ม', 'ขนมปัง', 'ปังปิ้ง', 'ปังเย็น'];

// ลำดับสำคัญ: คำที่เจอก่อนจะกำหนดไอคอน
const BAR_KEYWORDS = [
  { icon: '🍞', words: ['ปัง', 'toast', 'bread'] },
  { icon: '☕', words: ['กาแฟ', 'คาปู', 'ลาเต้', 'เอสเปรสโซ', 'อเมริกาโน', 'coffee', 'latte'] },
  { icon: '🍵', words: ['ชา', 'matcha', 'มัทฉะ', 'tea'] },
  { icon: '🥛', words: ['นม', 'milk', 'โกโก้', 'ไมโล', 'โอวัลติน', 'น้ำ', 'โซดา', 'ปั่น', 'สมูทตี้', 'เครื่องดื่ม'] },
];

const LATE_AFTER_MIN = 7; // เกินกี่นาทีให้เตือนสีแดง
const FLASH_MS = 5000;
const ACTIVE_STATUSES = ['received', 'cooking'];

// ---------- helpers ----------
const byOldestFirst = (a, b) => new Date(a.created_at) - new Date(b.created_at);
const tableOf = (o) => o.table_number ?? o.table_no ?? o.table ?? '-';
// ค่า bar_status: null/'pending' = รอทำ, 'preparing' = กำลังเตรียม, 'done' = ชงเสร็จแล้ว
const barStatusOf = (o) => o.bar_status || 'pending';

function parseItems(items) {
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function barIconOf(item) {
  const cat = String(item.category ?? '').toLowerCase();
  const name = String(item.name ?? '').toLowerCase();

  // มีหมวดหมู่ระบุ → ใช้หมวดตัดสิน
  if (cat) {
    if (!BAR_CATEGORIES.some((c) => cat.includes(c.toLowerCase()))) return null;
    const hit = BAR_KEYWORDS.find((k) => k.words.some((w) => name.includes(w.toLowerCase())));
    return hit ? hit.icon : cat.includes('ปัง') || cat.includes('bread') || cat.includes('toast') ? '🍞' : '🥛';
  }
  // ไม่มีหมวด → เช็คจากชื่อเมนู
  const hit = BAR_KEYWORDS.find((k) => k.words.some((w) => name.includes(w.toLowerCase())));
  return hit ? hit.icon : null;
}

// คืนเฉพาะรายการของโซนบาร์ พร้อมไอคอน
function barItemsOf(order) {
  return parseItems(order.items)
    .map((it) => ({ ...it, icon: barIconOf(it) }))
    .filter((it) => it.icon);
}

// ออเดอร์นี้ควรอยู่บนจอบาร์ไหม
const belongsOnBar = (o) =>
  ACTIVE_STATUSES.includes(o.status) && barStatusOf(o) !== 'done' && barItemsOf(o).length > 0;

function formatClock(iso) {
  return (
    new Date(iso).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Bangkok',
    }) + ' น.'
  );
}
const minutesSince = (iso, now) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
function formatAgo(mins) {
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  return `${Math.floor(mins / 60)} ชม. ${mins % 60} นาทีที่แล้ว`;
}

// ---------- page ----------
export default function BarPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [flashIds, setFlashIds] = useState(() => new Set());
  const [now, setNow] = useState(() => Date.now());

  const audioCtxRef = useRef(null);
  const busyRef = useRef(new Set());

  // ---------- เสียงแจ้งเตือน (ต้องแตะหนึ่งครั้งก่อนเบราว์เซอร์จึงยอมเล่นเสียง) ----------
  const enableSound = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      audioCtxRef.current.resume();
      setSoundReady(true);
      playChime(audioCtxRef.current);
    } catch {
      /* ไม่มีเสียงก็ยังใช้งานได้ */
    }
  }, []);

  const chime = useCallback(() => {
    if (audioCtxRef.current) playChime(audioCtxRef.current);
  }, []);

  // ---------- โหลดข้อมูล ----------
  const fetchOrders = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('orders')
      .select('*')
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: true });

    if (err) {
      setError('โหลดออเดอร์ไม่สำเร็จ กำลังลองใหม่อัตโนมัติ');
    } else {
      setError(null);
      setOrders((data ?? []).filter(belongsOnBar));
    }
    setLoading(false);
  }, []);

  // ---------- โหลดครั้งแรก + Realtime ----------
  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('bar-orders')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          const order = payload.new;
          if (!belongsOnBar(order)) return; // ไม่มีเมนูบาร์ → ไม่แสดง ไม่มีเสียง

          setOrders((prev) =>
            prev.some((o) => o.id === order.id) ? prev : [...prev, order].sort(byOldestFirst)
          );
          chime();
          setFlashIds((prev) => new Set(prev).add(order.id));
          setTimeout(() => {
            setFlashIds((prev) => {
              const next = new Set(prev);
              next.delete(order.id);
              return next;
            });
          }, FLASH_MS);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const order = payload.new;
          setOrders((prev) => {
            if (!belongsOnBar(order)) return prev.filter((o) => o.id !== order.id);
            const exists = prev.some((o) => o.id === order.id);
            const next = exists
              ? prev.map((o) => (o.id === order.id ? { ...o, ...order } : o))
              : [...prev, order];
            return next.sort(byOldestFirst);
          });
        }
      )
      .subscribe((status) => {
        const ok = status === 'SUBSCRIBED';
        setConnected(ok);
        if (ok) fetchOrders(); // ต่อกลับมาแล้วดึงข้อมูลใหม่ กันพลาดตอนหลุด
      });

    const poll = setInterval(fetchOrders, 60000);
    const onVisible = () => document.visibilityState === 'visible' && fetchOrders();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, chime]);

  // ---------- นาฬิกา "x นาทีที่แล้ว" ----------
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // ---------- กันหน้าจอดับ ----------
  useEffect(() => {
    let lock = null;
    const request = async () => {
      try {
        if ('wakeLock' in navigator) lock = await navigator.wakeLock.request('screen');
      } catch {
        /* ไม่รองรับก็ข้าม */
      }
    };
    request();
    const onVisible = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release?.().catch(() => {});
    };
  }, []);

  // ---------- เปลี่ยนสถานะฝั่งบาร์ (อัปเดตคอลัมน์ bar_status ไม่แตะ status ของครัว) ----------
  const changeBarStatus = useCallback(
    async (order, next) => {
      if (busyRef.current.has(order.id)) return;
      busyRef.current.add(order.id);

      setOrders((prev) =>
        next === 'done'
          ? prev.filter((o) => o.id !== order.id)
          : prev.map((o) => (o.id === order.id ? { ...o, bar_status: next } : o))
      );

      const { error: err } = await supabase.from('orders').update({ bar_status: next }).eq('id', order.id);
      busyRef.current.delete(order.id);

      if (err) {
        setError('อัปเดตสถานะไม่สำเร็จ ลองกดอีกครั้ง');
        fetchOrders();
      }
    },
    [fetchOrders]
  );

  const waiting = orders.filter((o) => barStatusOf(o) === 'pending').length;
  const preparing = orders.filter((o) => barStatusOf(o) === 'preparing').length;

  return (
    <main className="bar">
      <style>{css}</style>

      <header className="bar-top">
        <h1>บาร์น้ำและขนมปัง · สี่ นม นัว เวอร์</h1>
        <div className="bar-stats">
          <span className="stat stat-wait">รอทำ {waiting}</span>
          <span className="stat stat-prep">กำลังเตรียม {preparing}</span>
          <span className={`dot ${connected ? 'on' : 'off'}`}>
            {connected ? 'เชื่อมต่อแล้ว' : 'ขาดการเชื่อมต่อ'}
          </span>
        </div>
      </header>

      {error && (
        <div className="bar-error" role="alert">
          {error}
        </div>
      )}

      {!soundReady && (
        <button className="bar-sound" onClick={enableSound}>
          🔔 แตะเพื่อเปิดเสียงแจ้งเตือนออเดอร์ใหม่
        </button>
      )}

      {loading ? (
        <p className="bar-empty">กำลังโหลดออเดอร์…</p>
      ) : orders.length === 0 ? (
        <p className="bar-empty">ไม่มีออเดอร์ค้างที่บาร์ ออเดอร์ใหม่จะขึ้นที่นี่ทันที</p>
      ) : (
        <section className="bar-grid">
          {orders.map((order) => {
            const preparingNow = barStatusOf(order) === 'preparing';
            const mins = minutesSince(order.created_at, now);
            const late = mins >= LATE_AFTER_MIN;
            const items = barItemsOf(order);

            return (
              <article
                key={order.id}
                className={[
                  'card',
                  preparingNow ? 'card-prep' : 'card-wait',
                  flashIds.has(order.id) ? 'card-flash' : '',
                ].join(' ')}
              >
                <div className="card-head">
                  <div className="table-no">โต๊ะ {tableOf(order)}</div>
                  <div className="time">
                    <div>{formatClock(order.created_at)}</div>
                    <div className={late ? 'ago late' : 'ago'}>{formatAgo(mins)}</div>
                  </div>
                </div>

                <ul className="items">
                  {items.map((it, i) => (
                    <li key={i}>
                      <span className="icon" aria-hidden="true">{it.icon}</span>
                      <span className="name">
                        {it.name} <span className="qty">x {it.quantity}</span>
                        {it.note && <span className="note">{it.note}</span>}
                      </span>
                    </li>
                  ))}
                </ul>

                <button
                  className={preparingNow ? 'btn btn-done' : 'btn btn-start'}
                  onClick={() => changeBarStatus(order, preparingNow ? 'done' : 'preparing')}
                >
                  {preparingNow ? '✅ ชงเสร็จแล้ว / พร้อมเสิร์ฟ' : '🥛 เริ่มทำ'}
                </button>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}

// ---------- เสียงแจ้งเตือนสั้นๆ (ต่างจากเสียงของครัว จะได้แยกออก) ----------
function playChime(ctx) {
  const tone = (freq, start, dur) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + dur + 0.05);
  };
  tone(659, 0, 0.16);
  tone(880, 0.16, 0.16);
  tone(1319, 0.32, 0.3);
}

// ---------- styles ----------
const css = `
.bar {
  min-height: 100vh;
  background: #dcecf7;
  color: #3b2a1e;
  padding: 16px;
  font-family: system-ui, 'Noto Sans Thai', 'Sarabun', sans-serif;
}
.bar-top {
  display: flex; flex-wrap: wrap; align-items: center;
  justify-content: space-between; gap: 12px; margin-bottom: 16px;
}
.bar-top h1 { font-size: 28px; font-weight: 800; margin: 0; }
.bar-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.stat { font-size: 22px; font-weight: 800; padding: 6px 16px; border-radius: 999px; }
.stat-wait { background: #fff6e0; border: 3px solid #c9a274; }
.stat-prep { background: #f6a34a; color: #2b1705; border: 3px solid #f6a34a; }
.dot { font-size: 16px; font-weight: 600; padding-left: 20px; position: relative; }
.dot::before {
  content: ''; position: absolute; left: 4px; top: 50%;
  width: 11px; height: 11px; border-radius: 50%; transform: translateY(-50%);
}
.dot.on::before { background: #1f9d55; }
.dot.off::before { background: #d63838; }
.dot.off { color: #b02a2a; }

.bar-error {
  background: #b02a2a; color: #fff; font-size: 20px; font-weight: 700;
  padding: 12px 16px; border-radius: 10px; margin-bottom: 16px;
}
.bar-sound {
  display: block; width: 100%; margin-bottom: 16px; padding: 16px;
  font-size: 22px; font-weight: 800; color: #3b2a1e; background: #fff6e0;
  border: 4px solid #c9a274; border-radius: 12px; cursor: pointer;
}
.bar-empty { text-align: center; font-size: 28px; color: #5f7a8d; margin-top: 20vh; }

.bar-grid {
  display: grid; gap: 16px; align-items: start;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
@media (min-width: 1100px) { .bar-grid { grid-template-columns: repeat(4, 1fr); } }
@media (min-width: 720px) and (max-width: 1099px) { .bar-grid { grid-template-columns: repeat(3, 1fr); } }

.card {
  border-radius: 18px; padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
  border: 6px solid transparent;
}
.card-wait { background: #fff6e0; border-color: #c9a274; }
.card-prep { background: #bfe0f5; border-color: #f6a34a; }

.card-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 8px; padding-bottom: 10px; border-bottom: 3px solid rgba(59,42,30,0.18);
}
.table-no { font-size: 44px; font-weight: 900; line-height: 1.05; }
.time { text-align: right; font-size: 18px; font-weight: 700; }
.ago { font-size: 17px; font-weight: 600; color: #6b5a4c; }
.card-prep .ago { color: #3f5a6d; }
.ago.late { color: #c40000; font-weight: 900; }

.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.items li { display: flex; gap: 12px; align-items: flex-start; font-size: 30px; font-weight: 800; line-height: 1.2; }
.icon { font-size: 34px; line-height: 1.1; }
.qty { color: #a35a00; white-space: nowrap; }
.card-prep .qty { color: #8a3f00; }
.note { display: block; font-size: 20px; font-weight: 600; color: #6b5a4c; margin-top: 2px; }

.btn {
  margin-top: 4px; min-height: 72px; width: 100%; border: 0; border-radius: 14px;
  font-size: 26px; font-weight: 900; cursor: pointer;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent;
}
.btn:active { transform: scale(0.98); }
.btn:focus-visible { outline: 4px solid #3b2a1e; outline-offset: 3px; }
.btn-start { background: #2f7fb8; color: #fff; }
.btn-done { background: #1f9d55; color: #fff; }

.card-flash { animation: bar-flash 0.6s ease-in-out 0s 6; }
@keyframes bar-flash {
  0%, 100% { box-shadow: 0 0 0 0 rgba(47,127,184,0); }
  50% { box-shadow: 0 0 0 10px rgba(47,127,184,0.85); }
}
@media (prefers-reduced-motion: reduce) {
  .card-flash { animation: none; box-shadow: 0 0 0 8px rgba(47,127,184,0.85); }
}
`;
