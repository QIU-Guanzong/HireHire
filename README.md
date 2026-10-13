# 家合僱傭

香港家居僱傭及配對平台，品牌網址 https://hire.astock.top 。

開發倉庫：[QIU-Guanzong/HireHire](https://github.com/QIU-Guanzong/HireHire)。雲端接續開發先讀 `AGENTS.md` 及 [交接說明](docs/CLOUD_HANDOFF.md)。

## 使用流程

- `/employer`：僱主填寫聯絡方法、家庭情況、服務需要、時間與預算。
- `/jobseeker`：求職者填寫聯絡方法、技能、工作經驗與期望。
- `/candidates`：公開人選篩選、排序與分頁；詳情顯示已審核簡介、照片及分段工作經歷。
- `/saved`、`/compare`：本瀏覽器收藏最多30位，並列比較最多3位；選定人選後帶入僱主登記。
- `/services`、`/process`、`/fees`、`/faq`、`/contact`：服務資料、聘用流程、後台維護的價目及聯絡方法。未設定的價目與聯絡資料顯示待補充。
- `/admin`：搜尋及篩選登記、完整資料更正、跟進日期、版本衝突核對、選取或分批下載PDF。
- `/admin/candidates`：從求職登記建立草稿，整理公開簡介，再發布或暫停。必須有求職者現有公開同意；舊資料不會自動公開。
- `/admin/matches`：指定人選需求自動建立待聯絡配對；手動建立配對，更新面試、階段與內部備註，下載僱主及关联求職者資料。
- `/admin/settings`：維護公開聯絡資料及服務價目。

完整 PDF 包含所有登記資料與內部跟進內容。客戶 PDF 保留姓名，隱去電話、電郵、同意紀錄及內部備註。公開PDF只使用獨立的已審核簡介，不含私人原始資料；撤回公開同意後，簡介、照片及PDF即停止公開。照片使用Cloudflare R2，未提交照片有24小時使用期限，提交後保留供授權跟進。提交資料實際保存至 Cloudflare D1；瀏覽器草稿須由使用者選擇保存。首版不含支付、合約簽署或自動對外發送。

## 管理員設定

生產環境預設拒絕後台存取。以 Sites 環境變數設定 `ADMIN_EMAILS`，值為管理員 ChatGPT 登入電郵，以逗號分隔多位管理員並標記為 secret。後台由 Sites 驗證身分，再由伺服器核對白名單。本機測試的 `seedy@sites.test` 僅供預覽，生產環境沒有模擬登入或測試資料。

## 開發

Node.js 22.13 以上，唯一依賴鎖檔為 `package-lock.json`。

```sh
npm run install:ci
npm run dev -- --port 5177 --hostname 127.0.0.1
npm run db:generate
npm run build
```

D1 遷移在 `drizzle/`，本機只操作 `.wrangler/state`。正式遷移由 Sites 發布套用。`.openai/hosting.json` 保存唯一 `project_id`，後續開發重用同一項目。源碼由 Sites source helper 推送並打包，部署已儲存版本。憑據、`.dev.vars` 和測試資料不得提交。

驗證指令：`node node_modules/typescript/bin/tsc --noEmit`、`node scripts/platform-check.mjs --unit`。真實HTTP檢查僅接受本機loopback：`node scripts/platform-http-check.mjs http://127.0.0.1:5177`；測試需要本機Sites模擬管理帳戶，依exact IDs清理驗收資料。

## 設計與來源

繁體中文、白底、清楚的欄位與操作。首頁以服務及求職情況搜尋為主，求職登記作獨立入口。搜尋以篩選側欄及履歷摘要並列，詳情、比較和資料頁按工作任務採不同密度。表單按資料類別分步填寫，後台使用可搜尋的資料列表。短 CSS 狀態變化尊重減少動態效果，沒有動畫依賴。

- [安樂窩](https://www.mysweethome.hk/)：香港僱傭服務分類與流程參考，未複製品牌、內容或牌照。
- [GOV.UK question pages](https://design-system.service.gov.uk/patterns/question-pages/)：分組問題、選填標記、返回保留輸入。
- [GOV.UK check answers](https://design-system.service.gov.uk/patterns/check-answers/)：提交前檢查及修改。
- [USWDS progress easily](https://designsystem.digital.gov/patterns/complete-a-complex-form/progress-easily/)：手機分步填表、清楚進度、保存草稿。
- [USWDS keep a record](https://designsystem.digital.gov/patterns/complete-a-complex-form/keep-a-record/)：登記編號與資料副本。

PDF 字型來源與授權見 `public/fonts/`。

## 檔案管理

`work/` 用於必要測試及驗收證據；`dist/`、`.wrangler/`、`.vinext/` 可重建且不提交。任務完成後停止預覽服務，清理精確確認的重複工件與下載，保留正式原件及必要驗證結果。
