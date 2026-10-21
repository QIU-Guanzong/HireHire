import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

// Exercise the actual translator without a browser, database or network.
const source = stripTypeScriptTypes(await readFile(new URL('../lib/i18n.ts', import.meta.url), 'utf8'));
const { t, intakeResponseError } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const cases = [
  ['numeric range', '請填寫有效的年齡（18至100）。', 'Enter a valid Age (18–100).'],
  ['invalid option', '請選擇有效的國籍／地區。', 'Choose a valid Nationality / region.'],
  ['invalid boolean', '請選擇有效的薪金可商議。', 'Choose a valid Salary is negotiable.'],
  ['email', '請填寫有效的電郵地址。', 'Enter a valid email address.'],
  ['phone', '請填寫有效的聯絡電話（8至20位數字）。', 'Enter a valid contact number with 8–20 digits.'],
  ['date', '請填寫有效日期。', 'Enter a valid date.'],
  ['date confirmation', '請確認有效的日期。', 'Enter a valid date.'],
  ['work month', '請檢查第2份工作的年月。', 'Check the year and month for work history entry 2.'],
  ['work chronology', '第1份工作的結束月份不可早於開始月份。', 'The end month for work history entry 1 cannot be before the start month.'],
  ['work history parse', '請檢查工作經歷。', 'Check your work history.'],
  ['work experience required', '請填寫工作經歷或補充經驗；首次求職可填寫「首次求職」。', 'Enter your work history or additional experience. If this is your first job, enter “First job”.'],
  ['unrecognized response', '未能確認提交結果。資料仍在此頁，請重試。', 'The submission could not be confirmed. Your details are still on this page. Please retry.'],
  ['submission fallback', '暫時無法提交，請重試。', 'Submission is temporarily unavailable. Please retry.'],
  ['required text', '請填寫姓名。', 'Please enter Name.'],
  ['required option', '請選擇希望從事的服務。', 'Please select Services sought.'],
  ['length limit', '姓名最多可填寫80個字。', 'Name can be up to 80 characters.'],
  ['expired or used photo', '照片已過期或已使用，請重新上載。', 'The photo has expired or has already been used. Please upload it again.'],
  ['photo field', '請重新上載照片。', 'Please upload the photo again.'],
  ['withdrawn profile', '部分人選已停止公開，請檢查所選人選後再提交。', 'Some selected profiles are no longer public. Check your selection before submitting.'],
  ['withdrawn profile field', '請移除已停止公開的人選，其他資料仍可保留。', 'Remove profiles that are no longer public. You can keep your other details.'],
  ['idempotency conflict', '此登記已提交，請重新開始以登記其他資料。', 'This registration has already been submitted. Start a new registration to enter different details.'],
  ['selection race', '人選或照片狀態已更新，請檢查後再提交。', 'A selected profile or photo has changed. Check it before submitting.'],
  ['server work history', '請檢查工作經歷，每份須填寫地區及主要工作，日期順序須正確。', 'Check your work history. Each entry needs a location, main duties and dates in the correct order.'],
];
for (const [name, input, expected] of cases) {
  test(`English intake error: ${name}`, () => {
    assert.equal(t('en', input), expected);
    assert.doesNotMatch(t('en', input), /[\u3400-\u9fff]/u);
  });
  test(`Traditional Chinese intake error remains intact: ${name}`, () => {
    assert.equal(t('zh-Hant', input), input);
  });
}
for (const input of [undefined, null, {}, 42, 'SQLITE_ERROR: synthetic internal detail', '請填寫PRIVATE_DETAIL。', '香港', 'toString', '__proto__']) {
  test(`Unknown response uses a safe message: ${JSON.stringify(input)}`, () => {
    assert.equal(intakeResponseError(input), '未能確認提交結果。資料仍在此頁，請重試。');
    assert.equal(t('en', intakeResponseError(input)), 'The submission could not be confirmed. Your details are still on this page. Please retry.');
    assert.equal(intakeResponseError(input, '請檢查此欄位。'), '請檢查此欄位。');
  });
}
for (const input of ['照片已過期或已使用，請重新上載。', '部分人選已停止公開，請檢查所選人選後再提交。', '此登記已提交，請重新開始以登記其他資料。']) {
  test(`Known API error remains actionable: ${input}`, () => assert.equal(intakeResponseError(input), input));
}
