// The Coolkids LINE rich menu: 2500×1686 px, 2 rows × 3 columns.
//   row 1: shop logo (2 columns)            | กรอกเอกสาร
//   row 2: ติดต่อเรา (TikTok, Facebook) | โปรโมชั่น | เลือกรถ
// The same areas drive the demo page, the PNG export (/line-demo/richmenu) and
// backend/scripts/line-richmenu.js, which uploads the menu to the real OA.
// "message" areas send a keyword the chat bot answers (free replies); "liff"
// areas open a page of the site inside LINE.

export const SIZE = { width: 2500, height: 1686 }

export const AREAS = [
  { key: 'logo', bounds: { x: 0, y: 0, width: 1666, height: 843 }, action: { type: 'liff', path: '/' } },
  { key: 'documents', bounds: { x: 1666, y: 0, width: 834, height: 843 }, action: { type: 'liff', path: '/continue' } },
  { key: 'contact', bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: 'message', text: 'ติดต่อเรา' } },
  { key: 'promotions', bounds: { x: 833, y: 843, width: 833, height: 843 }, action: { type: 'message', text: 'โปรโมชั่น' } },
  { key: 'cars', bounds: { x: 1666, y: 843, width: 834, height: 843 }, action: { type: 'message', text: 'เลือกรถ' } },
]
