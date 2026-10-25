<script setup>
// Displays the server-rendered rental agreement. The HTML comes from our own
// API, which builds it from a fixed template and escapes every customer value,
// so v-html is safe here. Styles mirror the paper contract (Coolkids PDF).
defineProps({ html: { type: String, required: true } })
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="contract" v-html="html" />
</template>

<style scoped>
.contract {
  color: #1d1f26;
  font-size: 0.86rem;
  line-height: 1.6;
}
.contract :deep(i) {
  font-style: italic;
  color: #6b6e7a;
  font-size: 0.92em;
}
.contract :deep(.ct-head) {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 3px solid #2f6b3f;
  flex-wrap: wrap;
}
.contract :deep(.ct-brand) {
  display: grid;
  gap: 2px;
  font-size: 0.75rem;
  color: #4b5060;
}
.contract :deep(.ct-brand strong) {
  font-family: 'Unbounded', var(--font-display);
  font-size: 1rem;
  color: #e2362c;
  letter-spacing: 0.02em;
}
.contract :deep(.ct-title) {
  display: grid;
  justify-items: end;
  text-align: right;
}
.contract :deep(.ct-title h2) {
  font-family: var(--font-body);
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: 0;
}
.contract :deep(.ct-title em) {
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  color: #2f6b3f;
}
.contract :deep(.ct-title small) {
  color: #6b6e7a;
  font-size: 0.72rem;
}
.contract :deep(.ct-fields) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 24px;
  margin: 14px 0;
}
.contract :deep(.ct-fields dl) {
  display: grid;
  gap: 6px;
  margin: 0;
}
.contract :deep(.ct-fields div) {
  display: grid;
  grid-template-columns: minmax(130px, 42%) 1fr;
  gap: 8px;
  align-items: center;
}
.contract :deep(dt) {
  font-weight: 600;
  font-size: 0.78rem;
  line-height: 1.25;
}
.contract :deep(dt i) {
  display: block;
  font-size: 0.68rem;
}
.contract :deep(dd) {
  margin: 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: #ececee;
  font-weight: 500;
  min-height: 32px;
  overflow-wrap: anywhere;
}
.contract :deep(.ct-box) {
  padding: 12px 14px;
  border: 1px solid #d4d5da;
  border-radius: 10px;
  text-align: center;
}
.contract :deep(.ct-strong) {
  font-weight: 600;
  text-decoration: underline;
}
.contract :deep(.ct-en) {
  color: #4b5060;
  font-style: italic;
  font-size: 0.8rem;
}
.contract :deep(.ct-yn) {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  text-align: left;
}
.contract :deep(.ct-yn li) {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.contract :deep(.ct-yn b) {
  white-space: nowrap;
  color: #2f6b3f;
}
.contract :deep(.ct-split) {
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 18px;
  margin: 16px 0;
}
.contract :deep(.ct-inspect) {
  display: grid;
  gap: 10px;
  align-content: start;
}
.contract :deep(.ct-inspect-head) {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.contract :deep(.ct-inspect-head h4) {
  margin-top: 0;
}
.contract :deep(.ct-fuel) {
  flex: none;
  margin: 0;
  text-align: center;
  font-size: 0.72rem;
  font-weight: 600;
}
.contract :deep(.ct-fuel i) {
  display: block;
}
.contract :deep(.ct-diagram) {
  display: block;
  width: 100%;
  max-width: 460px;
  height: auto;
  margin-inline: auto;
}
.contract :deep(h3) {
  font-family: var(--font-body);
  font-size: 1.05rem;
  text-align: center;
  margin-top: 8px;
  letter-spacing: 0;
}
.contract :deep(h4) {
  font-family: var(--font-body);
  font-size: 0.88rem;
  font-weight: 700;
  margin: 12px 0 4px;
  letter-spacing: 0;
}
.contract :deep(p) {
  margin: 0 0 6px;
}
.contract :deep(.ct-center) {
  text-align: center;
}
.contract :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.76rem;
}
.contract :deep(.ct-fees caption) {
  padding: 8px;
  background: #1d1f26;
  color: #fff;
  font-weight: 700;
  border-radius: 8px 8px 0 0;
}
.contract :deep(.ct-fees caption i) {
  color: #fff;
}
.contract :deep(.ct-fees th),
.contract :deep(.ct-fees td) {
  padding: 5px 8px;
  border: 1px solid #d4d5da;
  text-align: left;
  vertical-align: top;
}
.contract :deep(.ct-fees th i) {
  display: block;
}
.contract :deep(.ct-fees td) {
  text-align: center;
  white-space: nowrap;
}
.contract :deep(.ct-notice) {
  font-size: 0.8rem;
}
.contract :deep(.ct-notice b) {
  color: #e2362c;
}
.contract :deep(.ct-money) {
  margin: 12px 0 6px;
}
.contract :deep(.ct-money th) {
  text-align: left;
  font-weight: 600;
  padding: 6px 8px;
}
.contract :deep(.ct-money th i) {
  display: block;
}
.contract :deep(.ct-money td) {
  padding: 6px 10px;
  background: #ececee;
  border-radius: 8px;
  border: 3px solid #fff;
  font-weight: 600;
  white-space: nowrap;
}
.contract :deep(.ct-total td) {
  background: #fdeceb;
  color: #c22a21;
}
.contract :deep(.ct-small) {
  font-size: 0.74rem;
  color: #4b5060;
}
.contract :deep(.ct-terms) {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid #d4d5da;
}
.contract :deep(.ct-terms .ct-en) {
  margin-top: 14px;
  font-style: normal;
}
.contract :deep(.ct-sign) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-top: 18px;
}
.contract :deep(.ct-sign > div) {
  display: grid;
  gap: 6px;
  font-weight: 600;
  font-size: 0.8rem;
}
.contract :deep(.ct-sign img) {
  height: 90px;
  width: 100%;
  object-fit: contain;
  border-radius: 10px;
  background: #ececee;
}
.contract :deep(.ct-sign small) {
  font-weight: 400;
  color: #6b6e7a;
}
.contract :deep(.ct-blank) {
  display: grid;
  place-items: center;
  height: 90px;
  border-radius: 10px;
  background: #ececee;
  color: #8d909b;
  font-weight: 400;
  font-size: 0.75rem;
}
@media (max-width: 640px) {
  .contract :deep(.ct-fields),
  .contract :deep(.ct-split),
  .contract :deep(.ct-sign) {
    grid-template-columns: 1fr;
  }
  .contract :deep(.ct-title) {
    justify-items: start;
    text-align: left;
  }
  .contract :deep(.ct-money tr) {
    display: grid;
    grid-template-columns: 1fr auto;
  }
}
</style>

<style>
/* ---- contract template v3 ("B-Rental-Agreement" layout) */
.contract .ct-head:has(.ct-logo) {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 14px;
  border-bottom: 0;
}
.contract .ct-logo {
  width: 120px;
  height: auto;
}
.contract .ct-head:has(.ct-logo) .ct-brand strong {
  color: #111318;
  font-size: 1.05rem;
}
.contract .ct-info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 22px;
  margin: 12px 0;
}
.contract .ct-col {
  display: grid;
  align-content: start;
  gap: 5px;
}
.contract .ct-pill {
  margin: 0 0 4px;
  padding: 6px 12px;
  border-radius: 6px;
  background: #111;
  color: #fff;
  font-size: 0.84rem;
  font-weight: 700;
  text-align: left;
}
.contract .ct-pill i {
  display: inline;
  color: #fff;
}
.contract .ct-row {
  display: grid;
  grid-template-columns: minmax(130px, 42%) 1fr;
  align-items: center;
  gap: 8px;
}
.contract .ct-lb b {
  display: block;
  font-size: 0.8rem;
  line-height: 1.2;
}
.contract .ct-lb i {
  display: block;
  font-size: 0.68rem;
}
.contract .ct-exec .ct-lb b,
.contract .ct-exec .ct-lb i {
  display: inline;
}
.contract .ct-exec {
  margin-bottom: 8px;
}
.contract .ct-box {
  min-height: 30px;
  padding: 5px 10px;
  border-radius: 7px;
  background: #ececec;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.contract .ct-choice {
  grid-template-columns: minmax(110px, 32%) 1fr;
}
.contract .ct-opts {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 10px;
}
.contract .ct-opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.74rem;
}
.contract .ct-opt b,
.contract .ct-opt i {
  display: block;
}
.contract .ct-dot {
  flex: none;
  width: 17px;
  height: 17px;
  border: 1px solid #c9c9c9;
  border-radius: 50%;
  background: #f4f4f4;
}
.contract .ct-dot.on {
  border-color: #111318;
  background: radial-gradient(circle, #111318 0 38%, #fff 42%);
}
.contract .ct-warn {
  padding: 10px 14px;
  border: 1px solid #f4a9b3;
  border-left: 5px solid #e2362c;
  border-radius: 8px;
  background: #fdeef0;
  color: #e2362c;
}
.contract .ct-warn p {
  margin: 0;
}
.contract .ct-warn .ct-strong {
  font-weight: 700;
  text-decoration: none;
}
.contract .ct-warn .ct-en {
  margin-top: 4px;
  color: #e2362c;
  font-weight: 600;
}
.contract .ct-q {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding: 7px 14px;
  border: 1px solid #f4a9b3;
  border-radius: 8px;
}
.contract .ct-q b {
  display: block;
}
.contract .ct-q i {
  display: block;
}
.contract .ct-ans {
  white-space: nowrap;
  color: #1f7a4d;
}
.contract .ct-split:has(.ct-side) {
  grid-template-columns: 1fr 0.95fr;
  gap: 12px;
}
.contract .ct-inspect {
  padding: 10px 12px;
  border-radius: 8px;
  background: #f6f6f6;
}
.contract .ct-inspect .ct-center b,
.contract .ct-inspect .ct-center i {
  display: block;
  font-size: 0.74rem;
}
.contract .ct-advice {
  font-size: 0.72rem;
}
.contract .ct-advice i {
  display: block;
  color: #111318;
  font-weight: 600;
}
.contract .ct-side {
  display: grid;
  align-content: start;
  gap: 6px;
}
.contract .ct-side .ct-fuel {
  display: flex;
  justify-content: center;
  gap: 12px;
}
.contract .ct-side .ct-fees {
  border: 4px solid #000;
}
.contract .ct-side .ct-fees caption {
  border-radius: 0;
  background: #000;
}
.contract .ct-side .ct-fees th i {
  color: #4b5060;
  font-style: normal;
}
.contract .ct-side .ct-fees td {
  text-align: right;
  white-space: normal;
  font-weight: 600;
}
.contract .ct-side .ct-fees td span {
  display: block;
}
.contract section.ct-notice {
  margin: 10px 0;
  padding: 8px 14px;
  border: 1px solid #f7d58a;
  border-left: 5px solid #f08a12;
  border-radius: 8px;
  background: #fff8e6;
  color: #d9770b;
  font-size: 0.8rem;
}
.contract section.ct-notice p {
  margin: 0;
}
.contract section.ct-notice b {
  color: #e2362c;
}
.contract section.ct-notice .ct-en {
  margin-top: 4px;
  color: #d9770b;
  font-weight: 600;
}
.contract section.ct-money {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 18px;
}
.contract section.ct-money > div {
  display: grid;
  grid-template-columns: minmax(120px, 45%) 1fr;
  align-items: center;
  gap: 8px;
}
.contract section.ct-money small {
  font-size: 0.68rem;
  color: #6b6e7a;
}
.contract .ct-box.ct-total {
  font-weight: 700;
}
.contract .ct-agreed {
  font-size: 0.74rem;
}
.contract .ct-agreed i {
  display: block;
  color: #111318;
  font-weight: 600;
}
.contract .ct-sign:has(.ct-sig) {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.contract .ct-sig {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 74px;
  padding: 6px 6px 18px;
  border: 1px solid #dcdcdc;
  border-left: 5px solid #555;
  border-radius: 7px;
}
.contract .ct-sig img {
  max-width: 85%;
  max-height: 46px;
}
.contract .ct-sig em {
  font-style: normal;
  font-size: 0.66rem;
  color: #6b6e7a;
  text-align: center;
}
.contract .ct-sig small {
  position: absolute;
  right: 6px;
  bottom: 3px;
  font-size: 0.6rem;
  color: #6b6e7a;
}
.contract .ct-terms h3 span {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
}
.contract .ct-terms .ct-sub {
  padding-left: 14px;
}
.contract .ct-en-terms {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed #c9cbd2;
  color: #3a3d4c;
}
.contract .ct-band {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding: 8px 12px;
  background: #000;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  overflow: hidden;
  white-space: nowrap;
}
@media (max-width: 640px) {
  .contract .ct-head:has(.ct-logo) {
    grid-template-columns: 1fr;
  }
  .contract .ct-info,
  .contract .ct-split:has(.ct-side),
  .contract section.ct-money {
    grid-template-columns: 1fr;
  }
  .contract .ct-sign:has(.ct-sig) {
    grid-template-columns: 1fr 1fr;
  }
  .contract .ct-band span + span {
    display: none;
  }
}
</style>
