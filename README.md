# SEENOM_NUAVER

ระบบสั่งอาหารร้านนมสดและขนมปังปิ้ง

**Stack:** Next.js (App Router, JavaScript) · Supabase · Vercel

## เริ่มใช้งาน

```bash
npm install
# แก้ค่าใน .env.local ให้เป็นของจริง
npm run dev
```

เปิด http://localhost:3000

## Environment Variables

| ชื่อ | คำอธิบาย |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL ของโปรเจกต์ Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |

เมื่อ deploy บน Vercel ให้เพิ่มตัวแปรทั้งสองใน Project Settings > Environment Variables
(`.env.local` ถูก ignore โดย git จึงไม่ถูก push ขึ้นไป)

## โครงสร้างโปรเจกต์

```
app/layout.js        Root Layout + Metadata
app/page.js          หน้าแรก (ลิงก์ไป /generate-qr และ /kitchen)
lib/supabaseClient.js  Supabase client
```

หน้าที่วางแผนไว้: `/generate-qr`, `/kitchen`

## โครงสร้างฐานข้อมูล (มีอยู่แล้วใน Supabase)

### `sessions`
| คอลัมน์ | หมายเหตุ |
|---|---|
| `id` | |
| `table_number` | |
| `status` | |
| `created_at` | |

### `menu_categories`
| คอลัมน์ | หมายเหตุ |
|---|---|
| `id` | |
| `name` | |
| `sort_order` | |

### `menu_items`
| คอลัมน์ | หมายเหตุ |
|---|---|
| `id` | |
| `category_id` | อ้างอิง `menu_categories.id` |
| `name` | |
| `price` | |
| `is_available` | |

### `orders`
| คอลัมน์ | หมายเหตุ |
|---|---|
| `id` | |
| `session_id` | อ้างอิง `sessions.id` |
| `table_number` | |
| `items` | `jsonb` |
| `total_price` | |
| `status` | |
| `created_at` | |

## ⚠️ ข้อควรระวังเรื่อง React / Next.js

โปรเจกต์นี้ใช้ **Next.js App Router เวอร์ชันล่าสุด** ซึ่ง `params` และ `searchParams`
ของ Dynamic Route จะถูกส่งมาเป็น **Promise เสมอ**

ดังนั้นใน **Client Components** ต้อง unwrap ด้วย Hook `use()` จาก React
(`import { use } from 'react'`) **ทุกครั้ง** ก่อนดึงไปใช้งาน:

```jsx
'use client';
import { use } from 'react';

export default function Page({ params, searchParams }) {
  const { id } = use(params);
  const query = use(searchParams);
  // ...
}
```

ส่วน Server Components ให้ใช้ `async` / `await` แทน:

```jsx
export default async function Page({ params }) {
  const { id } = await params;
}
```
