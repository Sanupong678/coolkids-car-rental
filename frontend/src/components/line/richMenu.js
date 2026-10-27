// The Coolkids LINE rich menu: 2500×1686 px, the shop's own artwork.
//   row 1: cover banner (all 3 columns)        → opens the site
//   row 2: เลือกรถที่ใช่ | ติดต่อเรา | การจองของฉัน
// The same areas drive the demo page, the PNG export (/line-demo/richmenu) and
// backend/scripts/line-richmenu.js, which uploads the menu to the real OA.
// "message" areas send a keyword the chat bot answers (free replies); "liff"
// areas open a page of the site inside LINE.

export const SIZE = { width: 2500, height: 1686 }

export const AREAS = [
  { key: 'cover', bounds: { x: 0, y: 0, width: 2500, height: 843 }, action: { type: 'liff', path: '/' } },
  { key: 'cars', bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: 'message', text: 'เลือกรถ' } },
  { key: 'contact', bounds: { x: 833, y: 843, width: 834, height: 843 }, action: { type: 'message', text: 'ติดต่อเรา' } },
  // an unfinished booking if there is one (documents, payment), otherwise My bookings
  { key: 'bookings', bounds: { x: 1667, y: 843, width: 833, height: 843 }, action: { type: 'liff', path: '/continue' } },
]
