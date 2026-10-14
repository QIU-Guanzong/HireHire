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

完整 PDF 包含所有登記資料與內部跟進內容。客戶 PDF 保留姓名，隱去電話、電郵、同意紀錄及內部備註。公開PDF只使用獨立的已審核簡介，不含私人原始資料；撤回公開同意後，簡介、照片及PDF即停止公開。GCP 遷移候選以 SQLite 保存資料，照片放在公開網站目錄以外的私有檔案目錄；未提交照片有24小時使用期限，提交後保留供授權跟進。瀏覽器草稿須由使用者選擇保存。首版不含支付、合約簽署或自動對外發送。

## 管理員設定

GCP 候選預設關閉管理入口。公開 HTTP 入口不信任外來身份標頭；管理入口使用獨立私有 Unix socket，須由運維確認存取範圍、檔案權限和固定本機 Origin 後才可啟用。它表示獲准的 OS／SSH 通道，不能冒稱已驗證某位 IAP 使用者。管理員設定仍按用戶要求延期；本輪沒有啟用真實管理權限。詳見 [GCP 交接](docs/GCP_MIGRATION_HANDOFF.md)。

## 開發

Node.js 22.13 以上，唯一依賴鎖檔為 `package-lock.json`。

```sh
npm run install:ci
npm run db:generate
npm run build
npm start
```

啟動前須由外部伺服器環境提供 `HIREHIRE_APP_ORIGIN`、`HIREHIRE_DATA_ROOT` 和至少24字元的 `HIREHIRE_RATE_LIMIT_SALT`。資料根目錄須在 release／公開目錄以外並可持久保存；以獨立非 root OS 帳戶執行。只有明確的隔離本機測試可使用 `HIREHIRE_LOCAL_QA=true` 與 `HIREHIRE_ALLOW_TEMPORARY_DATA_FOR_TESTS=true`，正式環境不用這兩項。

資料寫入預設關閉：`HIREHIRE_WRITES_ENABLED` 未設定或 `false` 時，所有公開登記／上載及管理更新均拒絕寫入。切換前完成舊站寫入口退役、空表複核和新站驗收，再由運維設 `true` 並重新啟動。`HIREHIRE_RELEASE_CHANNEL` 預設 `preview`；正式配置設為 `production`，品牌旁標記使用此伺服器設定，不以網址冒充發布狀態。

`drizzle/` 原遷移不變，SQLite 以原件 SHA 記錄套用狀態；未知既有 schema 會拒絕自行接管。`.openai/hosting.json` 及既有 Sites V4 僅保留舊發布／回滾關聯，不建立新站或再發布 Sites。憑據、環境檔、資料庫、照片和測試資料不得提交。現有域名的生產切換由運維另行執行，本候選尚未部署至 GCP。

驗證依次執行 TypeScript、`node scripts/platform-check.mjs --unit`、`npm run build`，另以 `npm run check:storage` 驗證私有持久儲存、`scripts/node-http-check.mjs` 驗證真實 Node loopback／Unix 合成流程。PDF 檢查須有 `pdftotext`。`/api/live` 是程序存活，`/api/health` 驗證六表、私有照片目錄和字型就緒；兩者均不回傳私人資料。

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
