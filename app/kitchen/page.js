'use client';
 
   import { createClient } from '@supabase/supabase-js';

   // สร้าง Supabase client ในไฟล์นี้เลย ไม่ต้อง import จากไฟล์อื่น (กัน path/alias ผิด)
   const supabase = createClient(
     process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
   );
 
const ACTIVE_STATUSES = ['received', 'cooking'];
const LATE_AFTER_MIN = 10; // เกินกี่นาทีให้เตือนสีแดง
const FLASH_MS = 5000;
 
// ---------- helpers ----------
const byOldestFirst = (a, b) => new Date(a.created_at) - new Date(b.created_at);
const isActive = (o) => ACTIVE_STATUSES.includes(o.status);
const tableOf = (o) => o.table_number ?? o.table_no ?? o.table ?? '-';
 
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
 
function minutesSince(iso, now) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}
 
function formatAgo(mins) {
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const h = Math.floor(mins / 60);
  return `${h} ชม. ${mins % 60} นาทีที่แล้ว`;
}
 
// ---------- page ----------
export default function KitchenPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [flashIds, setFlashIds] = useState(() => new Set());
  const [now, setNow] = useState(() => Date.now());
 
  const audioCtxRef = useRef(null);
  const busyRef = useRef(new Set()); // กันกดซ้ำระหว่างรออัปเดต
 
  // ---------- เสียงแจ้งเตือน ----------
  // เบราว์เซอร์ต้องการการแตะหนึ่งครั้งก่อนจึงจะเล่นเสียงได้
  const enableSound = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      audioCtxRef.current.resume();
      setSoundReady(true);
      playBeep(audioCtxRef.current); // เสียงทดสอบ
    } catch {
      /* ไม่มีเสียงก็ยังใช้งานได้ */
    }
  }, []);
 
  const beep = useCallback(() => {
    if (audioCtxRef.current) playBeep(audioCtxRef.current);
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
      setOrders(data ?? []);
    }
    setLoading(false);
  }, []);
 
  // ---------- โหลดครั้งแรก + Realtime ----------
  useEffect(() => {
    fetchOrders();
 
    const channel = supabase
      .channel('kitchen-orders')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          const order = payload.new;
          if (!isActive(order)) return;
 
          setOrders((prev) =>
            prev.some((o) => o.id === order.id)
              ? prev
              : [...prev, order].sort(byOldestFirst)
          );
          beep();
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
            if (!isActive(order)) return prev.filter((o) => o.id !== order.id);
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
        // เชื่อมต่อกลับมาแล้ว ดึงข้อมูลใหม่เผื่อพลาดออเดอร์ตอนหลุด
        if (ok) fetchOrders();
      });
 
    // สำรอง: ดึงข้อมูลใหม่ทุก 60 วินาที และเมื่อกลับมาที่แท็บนี้
    const poll = setInterval(fetchOrders, 60000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchOrders();
    };
    document.addEventListener('visibilitychange', onVisible);
 
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, beep]);
 
  // ---------- นาฬิกาสำหรับ "x นาทีที่แล้ว" ----------
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
 
  // ---------- กันหน้าจอดับ ----------
  useEffect(() => {
    let lock = null;
    const request = async () => {
      try {
        if ('wakeLock' in navigator) {
          lock = await navigator.wakeLock.request('screen');
        }
      } catch {
        /* ไม่รองรับก็ข้ามไป */
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
 
  // ---------- เปลี่ยนสถานะ ----------
  const changeStatus = useCallback(
    async (order, nextStatus) => {
      if (busyRef.current.has(order.id)) return;
      busyRef.current.add(order.id);
 
      // อัปเดตหน้าจอทันที (optimistic)
      setOrders((prev) =>
        nextStatus === 'served'
          ? prev.filter((o) => o.id !== order.id)
          : prev.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o))
      );
 
      const { error: err } = await supabase
        .from('orders')
        .update({ status: nextStatus })
        .eq('id', order.id);
 
      busyRef.current.delete(order.id);
 
      if (err) {
        setError('อัปเดตสถานะไม่สำเร็จ ลองกดอีกครั้ง');
        fetchOrders(); // คืนค่าจริงจากฐานข้อมูล
      }
    },
    [fetchOrders]
  );
 
  const waiting = orders.filter((o) => o.status === 'received').length;
  const cooking = orders.filter((o) => o.status === 'cooking').length;
 
  return (
    <main className="kds">
      <style>{css}</style>
 
      <header className="kds-top">
        <h1>ครัว · สี่ นม นัว เวอร์</h1>
        <div className="kds-stats">
          <span className="stat stat-wait">รอทำ {waiting}</span>
          <span className="stat stat-cook">กำลังทำ {cooking}</span>
          <span className={`dot ${connected ? 'on' : 'off'}`}>
            {connected ? 'เชื่อมต่อแล้ว' : 'ขาดการเชื่อมต่อ'}
          </span>
        </div>
      </header>
 
      {error && (
        <div className="kds-error" role="alert">
          {error}
        </div>
      )}
 
      {!soundReady && (
        <button className="kds-sound" onClick={enableSound}>
          🔔 แตะเพื่อเปิดเสียงแจ้งเตือนออเดอร์ใหม่
        </button>
      )}
 
      {loading ? (
        <p className="kds-empty">กำลังโหลดออเดอร์…</p>
      ) : orders.length === 0 ? (
        <p className="kds-empty">ไม่มีออเดอร์ค้าง ออเดอร์ใหม่จะขึ้นที่นี่ทันที</p>
      ) : (
        <section className="kds-grid">
          {orders.map((order) => {
            const isCooking = order.status === 'cooking';
            const mins = minutesSince(order.created_at, now);
            const late = mins >= LATE_AFTER_MIN;
            const items = parseItems(order.items);
 
            return (
              <article
                key={order.id}
                className={[
                  'card',
                  isCooking ? 'card-cooking' : 'card-received',
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
                      <span className="qty">{it.quantity}×</span>
                      <span className="name">{it.name}</span>
                    </li>
                  ))}
                </ul>
 
                <button
                  className={isCooking ? 'btn btn-serve' : 'btn btn-start'}
                  onClick={() => changeStatus(order, isCooking ? 'served' : 'cooking')}
                >
                  {isCooking ? '✅ จัดเสิร์ฟแล้ว' : '👨‍🍳 เริ่มทำ'}
                </button>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
 
// ---------- เสียง beep สองจังหวะ ----------
function playBeep(ctx) {
  const tone = (freq, start, dur) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + dur + 0.05);
  };
  tone(880, 0, 0.18);
  tone(1175, 0.22, 0.28);
}
 
// ---------- styles ----------
const css = `
.kds {
  min-height: 100vh;
  background: #101418;
  color: #f4f4f4;
  padding: 16px;
  font-family: system-ui, 'Noto Sans Thai', 'Sarabun', sans-serif;
}
.kds-top {
  display: flex; flex-wrap: wrap; align-items: center;
  justify-content: space-between; gap: 12px; margin-bottom: 16px;
}
.kds-top h1 { font-size: 28px; font-weight: 800; margin: 0; }
.kds-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.stat {
  font-size: 22px; font-weight: 800; padding: 6px 16px; border-radius: 999px;
}
.stat-wait { background: #ff8a1f; color: #1a1005; }
.stat-cook { background: #ffd23f; color: #1a1605; }
.dot { font-size: 16px; font-weight: 600; padding-left: 20px; position: relative; }
.dot::before {
  content: ''; position: absolute; left: 4px; top: 50%;
  width: 11px; height: 11px; border-radius: 50%; transform: translateY(-50%);
}
.dot.on::before { background: #3ddc84; }
.dot.off::before { background: #ff4d4d; }
.dot.off { color: #ff8b8b; }
 
.kds-error {
  background: #7a1c1c; color: #fff; font-size: 20px; font-weight: 700;
  padding: 12px 16px; border-radius: 10px; margin-bottom: 16px;
}
.kds-sound {
  display: block; width: 100%; margin-bottom: 16px; padding: 16px;
  font-size: 22px; font-weight: 800; color: #101418; background: #ffd23f;
  border: 0; border-radius: 12px; cursor: pointer;
}
.kds-empty {
  text-align: center; font-size: 28px; color: #9aa4ad; margin-top: 20vh;
}
 
.kds-grid {
  display: grid; gap: 16px; align-items: start;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
@media (min-width: 1100px) { .kds-grid { grid-template-columns: repeat(4, 1fr); } }
@media (min-width: 720px) and (max-width: 1099px) { .kds-grid { grid-template-columns: repeat(3, 1fr); } }
 
.card {
  border-radius: 16px; padding: 16px; color: #16130f;
  display: flex; flex-direction: column; gap: 12px;
  border: 6px solid transparent;
}
.card-received { background: #ffffff; border-color: #ff8a1f; }
.card-cooking { background: #ffe9a8; border-color: #f2b705; }
 
.card-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 8px; padding-bottom: 10px; border-bottom: 3px solid rgba(0,0,0,0.15);
}
.table-no { font-size: 44px; font-weight: 900; line-height: 1.05; }
.time { text-align: right; font-size: 18px; font-weight: 700; }
.ago { font-size: 17px; font-weight: 600; color: #5b544a; }
.ago.late { color: #c40000; font-weight: 900; }
 
.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.items li { display: flex; gap: 12px; align-items: baseline; font-size: 30px; font-weight: 800; line-height: 1.2; }
.qty { min-width: 2.4em; color: #c25200; }
.card-cooking .qty { color: #8a5a00; }
 
.btn {
  margin-top: 4px; min-height: 68px; width: 100%; border: 0; border-radius: 12px;
  font-size: 26px; font-weight: 900; cursor: pointer;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent;
}
.btn:active { transform: scale(0.98); }
.btn:focus-visible { outline: 4px solid #101418; outline-offset: 3px; }
.btn-start { background: #ff8a1f; color: #1a1005; }
.btn-serve { background: #1f9d55; color: #fff; }
 
.card-flash { animation: kds-flash 0.6s ease-in-out 0s 6; }
@keyframes kds-flash {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,138,31,0); }
  50% { box-shadow: 0 0 0 10px rgba(255,138,31,0.9); }
}
@media (prefers-reduced-motion: reduce) {
  .card-flash { animation: none; box-shadow: 0 0 0 8px rgba(255,138,31,0.9); }
}
`;
 
