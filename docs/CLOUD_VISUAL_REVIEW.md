# 家合僱傭視覺改版候選 · 2026-10-14

本輪為本地視覺候選，等待桌面及手機截圖審閱；尚未推送 GitHub、建立 PR 或發布 Sites。正式站仍以已完成發布的 V4 為準，保留上輪發布與回滾資料。

- 工作區：`/workspace/HireHire`；分支：`codex/visual-refresh-20261014`。
- 回滾及開發基線：`7427a150982357f93c0f49e4720319dd7d1c75d2`。
- 基線 tree：`1721f8461f133575458cbcec26a8be0bbc1c50ec`；候選提交以本輪交付回執為準。

## 改動與範圍

首頁以原創窗格插圖、自然香港繁體用語及克制的暖黃／紫色建立家居服務品牌。搜尋及聘用需要入口更清楚，求職者登記保持獨立；服務列表與聘用流程提高字級及資訊層次。

搜尋頁採桌面兩列卡片、手機單列；照片、年資、到職日期及薪金更易閱讀，獨立操作至少 44px。十項篩選、七種排序及原有載入、錯誤、重試、空態、分頁、收藏和比較行為保持。真實零人選空態沒有加入示範檔案或虛構數字。

主要改動為 `app/page.tsx`、`components/home-window.tsx`、`app/visual-refresh.css`、`components/candidates-visual.css`，另有樣式導入及搜尋頁 class。共享頁首樣式跨頁面生效；表單及後台佈局沒有重做。沒有複製參考站 logo、人物照片或原文。

## 參考與保留行為

2026-10-13 的已有實際觀察支持黃紫色系、白色主體及 FAQ 層次的定性參考。最新雲端 REA 訪問在 CONNECT 階段返回 403，未取得目標 DOM、CSS 或新截圖；另一線程的只讀補證仍在進行。本輪不宣稱完成 REA 審計、精確取色或復刻參考站。

導覽保留按鈕展開、鍵盤焦點及 Escape 返回行為，可對照 [W3C APG disclosure navigation](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/)；操作按鈕與狀態表達參考 [GOV.UK button](https://design-system.service.gov.uk/components/button/)。

- 公開人選仍須本人現有公開同意及職員發布；公開／客戶 PDF 與完整私人資料分隔，完整 PDF 仍要求管理員授權。
- 登記冪等鍵、未確認提交的原始重試資料、自選草稿、照片所有權／期限及版本衝突處理保持。
- 沒有資料庫、遷移、權限或生產設定改動；管理員配置仍按使用者決定暫緩。

## 驗證

| 檢查 | 結果 |
| --- | --- |
| TypeScript | 通過，退出碼 0 |
| 隔離 API／PDF | 683 項通過 |
| 初次及最終構建 | 均通過，退出碼 0；最終構建包含確認後的觸控區與圖標 CSS 修正 |
| 瀏覽器 | 89 項檢查，0 失敗；11 張截圖 |
| 佈局與操作 | 1440、360、393、700、701px；手機觸控模擬、鍵盤及 reduced motion |
| 資料隔離 | API 回應均為合成攔截；本地及生產 POST 均為 0，生產寫入 0 |

瀏覽器最多同時一個 context，已全部關閉。截圖人選是無照片的合成資料，僅供本地佈局驗證，不代表平台真實人選。未測物理手機、讀屏或真實管理員 PDF；測試通過不代表視覺已獲使用者批准。

## 證據與收尾

證據保存在忽略的 `work/visual-refresh-20261014/`；`browser-report.json` 記錄上述 89 項結果。截圖清單：

- 桌面：`home-desktop.png`、`home-desktop-viewport.png`、`catalog-desktop.png`、`catalog-desktop-viewport.png`、`catalog-empty-desktop.png`。
- 手機：`home-360.png`、`home-360-viewport.png`、`catalog-360.png`、`catalog-393.png`、`catalog-empty-360.png`、`nav-360.png`。

executor 斷連令舊 session 失效後，已按精確任務命令與父子進程核對，停止 27167／27195／27202；5177 已關閉，原有無關 1040 未動。`cleanup-receipt.json` 保存收尾結果。沒有新增部署、任務或生產驗收資料。
