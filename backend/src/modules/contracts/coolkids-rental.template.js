import { escapeHtml as esc } from "./render.js";
import { FEES, TERMS_EN, TERMS_TH } from "./contract-terms.js";

// Coolkids rental agreement (source: "B-Rental-Agreement" PDF, 2 pages), as a
// contract_templates body. Placeholders are {{path}} (HTML-escaped) and
// {{#if path}}…{{else}}…{{/if}}. Changing the wording = bump version and re-run
// `npm run db:seed:coolkids`; signed contracts keep the version they were signed on.

const label = (th, en) => `<b>${th}</b><i>${en}</i>`;
const field = (th, en, value) => `<div class="ct-row"><span class="ct-lb">${label(th, en)}</span><span class="ct-box">${value}</span></div>`;
const radio = (flag, th, en) =>
  `<span class="ct-opt"><span class="ct-dot{{#if ${flag}}} on{{/if}}"></span><span>${label(th, en)}</span></span>`;
const blank = (th, en) => `<span class="ct-opt"><span class="ct-dot"></span><span>${label(th, en)}</span></span>`;
const terms = (list) =>
  list
    .map(([h, items]) => `<h4>${esc(h)}</h4>${items.map((p) => `<p${/^\(/.test(p) ? ' class="ct-sub"' : ""}>${esc(p)}</p>`).join("")}`)
    .join("");

export const TEMPLATE = {
  code: "coolkids_rental",
  version: 3,
  locale: "th",
  title: "สัญญาเช่ารถยนต์ / Rental Agreement",
  variablesSchema: {
    required: ["company", "contract", "renter", "vehicle", "rental", "money", "declarations"],
  },
  body: /* html */ `
<article class="ct">
  <header class="ct-head">
    <img class="ct-logo" src="/brand/logo-dark.webp" alt="Coolkids Car Rental" />
    <div class="ct-brand">
      <strong>{{company.name}}</strong>
      <span>{{company.address}}</span>
      <span>โทรศัพท์ {{company.phone}} เลขที่ภาษี {{company.taxId}} (สำนักงานใหญ่)</span>
    </div>
    <div class="ct-title">
      <h2>สัญญาเช่ารถยนต์</h2>
      <em>RENTAL AGREEMENT</em>
      <small>เลขที่ / No. {{contract.number}} · {{contract.issuedDate}}</small>
    </div>
  </header>

  <section class="ct-info">
    <div class="ct-col">
      <h3 class="ct-pill">ข้อมูลผู้เช่าและรายละเอียดรถยนต์ <i>Renter &amp; Vehicle Information</i></h3>
      ${field("ชื่อ-นามสกุล ผู้เช่า", "Renter's Full Name", "{{renter.fullName}}")}
      ${field("เลขประจำตัวประชาชน", "ID Card Number / Passport No.", "{{renter.idDocMasked}}")}
      ${field("เลขที่ใบขับขี่", "Driving License Number", "{{renter.licenseMasked}}")}
      ${field("ที่อยู่", "Address", "{{renter.address}}")}
      ${field("เบอร์โทรศัพท์มือถือ", "Mobile Phone Number", "{{renter.phone}}")}
      ${field("วันที่รับรถ / เวลา", "Pick-up Date / Time", "{{rental.pickupAt}}")}
      ${field("วันที่คืนรถ / เวลา", "Return Date / Time", "{{rental.returnAt}}")}
    </div>
    <div class="ct-col">
      <div class="ct-row ct-exec"><span class="ct-lb"><b>สัญญาฉบับนี้เขียนที่</b> <i>Executed at</i></span><span class="ct-box">{{rental.executedAt}}</span></div>
      ${field("ชื่อ-นามสกุล ผู้ค้ำประกัน", "Guarantor's Full Name", "")}
      ${field("เลขประจำตัวประชาชน", "ID Card Number / Passport No.", "")}
      ${field("รุ่นรถยนต์", "Vehicle Model", "{{vehicle.make}} {{vehicle.model}}")}
      ${field("เลขทะเบียนรถ", "Vehicle Plate Number", "{{vehicle.plate}}")}
      ${field("สถานที่ใช้รถ", "Area of Operation", "{{rental.area}}")}
      <div class="ct-row ct-choice"><span class="ct-lb">${label("ชนิดน้ำมันเชื้อเพลิง", "Fuel Type")}</span><span class="ct-opts">
        ${radio("vehicle.gasohol", "แก๊สโซฮอล 95", "Gasoline 95")}${radio("vehicle.diesel", "ดีเซล B7 / พรีเมียม", "Diesel B7 / Premium")}</span></div>
      <div class="ct-row ct-choice"><span class="ct-lb">${label("จุดประสงค์การใช้รถ", "Purpose of car rental")}</span><span class="ct-opts">
        ${blank("การท่องเที่ยว/ใช้งานประจำวัน", "Travel / Daily Use")}${blank("รถทดแทน", "Replacement Car")}</span></div>
    </div>
  </section>

  <section class="ct-warn">
    <p class="ct-strong">ข้อมูลถูกต้องครบถ้วน และต้องตอบ “ใช่” เพื่อให้รถยนต์ได้รับความคุ้มครอง โดยบริษัทประกันภัย ทางบริษัทไม่อนุญาตให้ทำการเช่ารถยนต์ หรือให้รถยนต์ได้รับความคุ้มครอง หากเงื่อนไข ข้อหนึ่งข้อใดไม่ครบถ้วน</p>
    <p class="ct-en">All information provided must be accurate and complete, and you must answer 'Yes' to ensure the vehicle is covered by insurance. We reserve the right to decline the rental or withhold insurance coverage if any of the terms and conditions are not fully met.</p>
  </section>
  <div class="ct-q"><span>${label("ผู้เช่ามีใบอนุญาตขับขี่ตัวจริงหรือไม่?", "Does the renter possess the original driving license?")}</span><b class="ct-ans">{{declarations.hasOriginalLicense}}</b></div>
  <div class="ct-q"><span>${label("ข้อมูลในสัญญาเช่าตรงกับใบอนุญาตขับขี่หรือไม่?", "Does the information in the rental agreement match the driving license?")}</span><b class="ct-ans">{{declarations.infoMatchesLicense}}</b></div>

  <section class="ct-split">
    <div class="ct-inspect">
      <p class="ct-center">${label("ระบุรอยขีดข่วน, รอยบุบ, หรือรอยร้าวของกระจก และความเสียหายอื่นๆที่พบในรถ", "Please specify any scratches, dents, or windshield cracks as well as any other damages found in the vehicle.")}</p>
      <img class="ct-diagram" src="/contract/car-diagram.png" alt="แผนผังรถสำหรับระบุตำแหน่งความเสียหาย / Vehicle damage diagram" />
      <p class="ct-advice">แนะนำให้ผู้เช่าตรวจสอบสภาพรถยนต์อย่างละเอียดก่อนรับมอบรถ และบันทึกภาพถ่ายร่องรอยตำหนิหรือความเสียหายเดิมที่ปรากฏอยู่บนตัวรถยนต์ไว้เป็นหลักฐาน พร้อมทั้งแจ้งให้ผู้ให้เช่าทราบก่อนเริ่มใช้รถยนต์
        <i>The rental is advised to thoroughly inspect the condition of the vehicle prior to taking delivery, photograph and record any existing defects or pre-existing damage found on the vehicle as evidence, and notify the Lessor before operating the vehicle.</i></p>
    </div>
    <div class="ct-side">
      <figure class="ct-fuel">
        <figcaption>${label("ระดับน้ำมัน", "Fuel Level")}</figcaption>
        <svg viewBox="0 0 120 70" width="110" height="64" aria-hidden="true">
          <path d="M12 62a48 48 0 0 1 96 0" fill="none" stroke="#9fb7c9" stroke-width="10" stroke-linecap="round" />
          <path d="M60 14v8M26 28l6 6M94 28l-6 6" stroke="#5f7d93" stroke-width="3" stroke-linecap="round" />
          <text x="8" y="69" font-size="11" fill="#5f7d93">E</text><text x="106" y="69" font-size="11" fill="#5f7d93">F</text>
          <text x="51" y="40" font-size="11" fill="#5f7d93">1/2</text>
        </svg>
      </figure>
      <table class="ct-fees">
        <caption>อัตราค่าปรับ Penalty and Service Fees</caption>
        <tbody>
          ${FEES.map(([th, en, price]) => `<tr><th>${esc(th)}<i>${esc(en)}</i></th><td>${price.split("|").map((l) => `<span>${esc(l)}</span>`).join("")}</td></tr>`).join("\n          ")}
        </tbody>
      </table>
    </div>
  </section>

  <section class="ct-notice">
    <p><b>โปรดทราบ</b> ผู้เช่ามีหน้าที่รับผิดชอบต่อความเสียหายใดๆ ที่เกิดขึ้นแก่รถยนต์คันที่เช่า ซึ่งอยู่นอกเหนือจากร่องรอยตำหนิหรือความเสียหายเดิมของรถยนต์ที่มีอยู่ก่อนการส่งมอบรถให้แก่ผู้เช่า ซึ่งทั้งนี้ ไม่ว่าความเสียหายดังกล่าวจะเกิดขึ้นในลักษณะใดก็ตาม โดยให้เป็นไปตามเงื่อนไขและข้อกำหนดแห่งสัญญาเช่ารถยนต์</p>
    <p class="ct-en"><b>NOTICE</b> "The rental shall be held responsible for any damage occurring to the rented vehicle that exceeds pre-existing defects or damage existing prior to the vehicle's delivery to the Lessee, regardless of how such damage occurs, subject to the terms and conditions of this Vehicle Rental Agreement.</p>
  </section>

  <section class="ct-money">
    <div><span class="ct-lb">${label("ค่าเช่ารถทั้งหมด", "Total Rental Fee")} <small>({{rental.days}} วัน/days)</small></span><span class="ct-box">{{money.rental}}</span></div>
    <div><span class="ct-lb">${label("เงินประกัน", "Security Deposit")}</span><span class="ct-box">{{money.deposit}}</span></div>
    <div><span class="ct-lb">${label("ค่าบริการจัดส่ง(ถ้ามี)", "Delivery Fee (if any)")}</span><span class="ct-box">{{money.delivery}}</span></div>
    <div><span class="ct-lb">${label("รวมค่าใช้จ่ายรับรถ", "Total Amount Payable")}</span><span class="ct-box ct-total">{{money.totalPayable}}</span></div>
  </section>
  <p class="ct-small">ส่วนลด / Discount: {{money.discount}} · ชำระออนไลน์แล้ว / Paid online: {{money.paidOnline}} · เงินประกันชำระ ณ วันรับรถ และคืนเต็มจำนวนเมื่อคืนรถในสภาพปกติ / The deposit is paid at handover and refunded in full when the vehicle is returned in normal condition.</p>
  <p class="ct-agreed">ผู้เช่าได้อ่านสัญญาและเข้าใจในข้อสัญญาทุกข้อครบถ้วนแล้ว และได้ตรวจสภาพรถโดยรอบและพึงพอใจในสภาพรถก่อนรับมอบแล้ว
    <i>The renter has read, understood, and agreed to all terms and conditions of this Agreement in full. And has inspected the vehicle's condition and is satisfied with its state prior to taking delivery.</i></p>

  <footer class="ct-sign">
    <div class="ct-sig">{{#if signature.dataUrl}}<img src="{{signature.dataUrl}}" alt="ลายมือชื่อผู้เช่า" /><em>{{renter.fullName}} · {{signature.signedAt}}</em>{{else}}<em>รอลงนาม / Awaiting signature</em>{{/if}}<small>ลงลายมือชื่อผู้เช่า/ Renter sign for agree.</small></div>
    <div class="ct-sig"><small>ลงลายมือชื่อผู้ค้ำ/ Guarantor sign for agree.</small></div>
    <div class="ct-sig"><small>ลงลายมือชื่อผู้ให้เช่า/ Lessor sign for agree.</small></div>
    <div class="ct-sig"><small>ลงลายมือชื่อผู้ส่งรถ/ Coolkids staff.</small></div>
  </footer>

  <section class="ct-terms">
    <h3>โปรดอ่านสัญญาเช่าและข้อตกลงให้ละเอียด<span>Please read the Rental Agreement and Terms &amp; Conditions carefully.</span></h3>
    ${terms(TERMS_TH)}
    <div class="ct-en-terms">
      <h3>English translation<span>The Thai text above is the original and prevails.</span></h3>
      ${terms(TERMS_EN)}
    </div>
    <div class="ct-band"><span>COOLKIDS CAR RENTAL-RENTAL AGREEMENT</span><span>COOLKIDS CAR RENTAL-RENTAL AGREEMENT</span><span>COOLKIDS CAR RENTAL-RENTAL AGREEMENT</span></div>
  </section>
</article>`,
};
