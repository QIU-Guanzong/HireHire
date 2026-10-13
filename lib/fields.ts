import { candidateTypes, type WorkExperience } from './platform-types';
export type IntakeKind = 'jobseeker' | 'employer';
export type Field = { name: string; label: string; type?: string; required?: boolean; options?: string[]; hint?: string; max?: number; showIf?: { field: string; equals?: string | boolean; includesAny?: string[] } };
export type Section = { title: string; description: string; fields: Field[] };
export const services = ['家傭', '陪月', '長者照顧', '家居清潔', '育兒照顧'];
export const districts = ['中西區','灣仔','東區','南區','油尖旺','深水埗','九龍城','黃大仙','觀塘','葵青','荃灣','屯門','元朗','北區','大埔','沙田','西貢','離島'];
export const statuses = ['新登記', '已聯絡', '配對中', '已完成', '暫停'];
const contact: Field[] = [
  {name:'fullName',label:'姓名',required:true,max:80},
  {name:'phone',label:'聯絡電話',type:'tel',required:true,hint:'可填寫香港或海外電話，請包括區號。',max:30},
  {name:'email',label:'電郵',type:'email',max:160},
];
export const sections: Record<IntakeKind, Section[]> = {
  jobseeker: [
    {title:'基本資料',description:'留下聯絡方法，方便我們與你安排合適工作。',fields:[...contact,
      {name:'englishName',label:'英文姓名',max:80},
      {name:'nationality',label:'國籍／地區',type:'select',required:true,options:['香港','中國內地','菲律賓','印尼','其他']},
      {name:'currentLocation',label:'目前所在地',required:true,max:100},
      {name:'education',label:'教育程度',type:'select',options:['小學','中學','專上教育','大學或以上','其他']},
      {name:'candidateType',label:'目前求職情況',type:'select',options:candidateTypes},
      {name:'age',label:'年齡',type:'number'},
      {name:'contractEndDate',label:'目前合約完結日期',type:'date'},
    ]},
    {title:'經驗與技能',description:'告訴我們你擅長的工作，以及過往的照顧經驗。',fields:[
      {name:'services',label:'希望從事的服務',type:'checkboxes',required:true,options:services},
      {name:'languages',label:'可使用的語言',type:'checkboxes',required:true,options:['廣東話','普通話','英語','印尼語','菲律賓語','其他']},
      {name:'yearsExperience',label:'相關工作年資',type:'select',required:true,options:['少於1年','1–2年','3–5年','6–10年','10年以上']},
      {name:'skills',label:'工作技能',type:'checkboxes',options:['煮食','清潔及熨衣','初生嬰兒照顧','兒童照顧','長者照顧','行動不便人士照顧','寵物照顧','陪診','陪月護理']},
      {name:'certificates',label:'培訓及證書',type:'textarea',hint:'例如陪月、急救或護理證書；沒有可留空。',max:1000},
      {name:'workExperienceJson',label:'工作經歷',type:'experience',max:18000,hint:'可逐份填寫過往工作，首次求職可在補充經驗填寫。'},
      {name:'workHistory',label:'補充工作經驗',type:'textarea',hint:'可補充照顧經驗；首次求職可填寫「首次求職」。',max:4000},
    ]},
    {title:'工作期望',description:'讓工作時間、地點與待遇更符合你的需要。',fields:[
      {name:'employmentType',label:'工作形式',type:'select',required:true,options:['全職住家','全職非住家','兼職','按次／短期','均可']},
      {name:'workLocations',label:'可工作地區',type:'checkboxes',required:true,options:['全香港',...districts]},
      {name:'availableFrom',label:'最快可開始日期',type:'date',required:true},
      {name:'salaryNegotiable',label:'薪金可商議',type:'boolean'},
      {name:'expectedSalary',label:'期望薪金（港元）',type:'number',required:true,showIf:{field:'salaryNegotiable',equals:false}},
      {name:'salaryUnit',label:'薪金計算方式',type:'select',required:true,options:['每月','每日','每小時','每次'],showIf:{field:'salaryNegotiable',equals:false}},
      {name:'schedule',label:'可工作時間',type:'textarea',hint:'例如星期一至五，上午9時至下午6時。',max:1000},
      {name:'introduction',label:'補充資料',type:'textarea',hint:'還有甚麼想讓僱主了解？',max:3000},
      {name:'publicProfileConsent',label:'同意公開求職簡介及照片',type:'boolean',hint:'可選擇讓網站公開核准後的求職簡介及你提供的照片。電話、電郵及完整登記資料只供後台跟進。'},
      {name:'publicName',label:'公開顯示名稱',max:80,hint:'可使用英文名字或簡稱。',showIf:{field:'publicProfileConsent',equals:true}},
      {name:'publicIntroduction',label:'公開自我介紹',type:'textarea',max:2000,hint:'只填寫希望公開的工作簡介，請勿填寫電話、住址或證件號碼。',showIf:{field:'publicProfileConsent',equals:true}},
    ]},
  ],
  employer: [
    {title:'聯絡與家庭',description:'先了解你的家庭情況與服務地點。',fields:[...contact,
      {name:'district',label:'服務地區',type:'select',required:true,options:districts},
      {name:'householdAdults',label:'成年人數',type:'number',required:true},
      {name:'children',label:'兒童人數及年齡',max:300,hint:'例如2位，分別3歲及7歲；沒有可留空。'},
      {name:'elderly',label:'長者及照顧需要',type:'textarea',max:1000},
      {name:'pets',label:'寵物情況',max:300},
      {name:'homeSize',label:'住宅面積（平方呎）',type:'number'},
    ]},
    {title:'服務需要',description:'把日常需要寫清楚，方便找到合適人選。',fields:[
      {name:'services',label:'需要的服務',type:'checkboxes',required:true,options:services},
      {name:'employmentType',label:'聘用形式',type:'select',required:true,options:['全職住家','全職非住家','兼職','按次／短期','尚未決定']},
      {name:'duties',label:'主要工作',type:'checkboxes',required:true,options:['煮食','清潔及熨衣','初生嬰兒照顧','兒童照顧','長者照顧','行動不便人士照顧','寵物照顧','陪診','陪月護理']},
      {name:'preferredLanguages',label:'溝通語言',type:'checkboxes',options:['廣東話','普通話','英語','其他','不限']},
      {name:'experienceRequired',label:'希望具備的經驗',type:'textarea',max:2000},
      {name:'dueDate',label:'預產期／寶寶出生日期',type:'date',showIf:{field:'services',includesAny:['陪月']}},
      {name:'serviceDays',label:'陪月服務日數',type:'number',showIf:{field:'services',includesAny:['陪月']}},
      {name:'newbornNeeds',label:'產後及嬰兒照顧安排',type:'textarea',max:1000,showIf:{field:'services',includesAny:['陪月']}},
      {name:'careNeeds',label:'長者日常照顧安排',type:'textarea',max:1000,showIf:{field:'services',includesAny:['長者照顧']}},
      {name:'mobility',label:'長者行動情況',type:'select',options:['可自行活動','需要扶助','使用輪椅','需要臥床照顧','稍後確認'],showIf:{field:'services',includesAny:['長者照顧']}},
      {name:'cleaningFrequency',label:'清潔服務頻率',type:'select',options:['每週一次','每週兩次','每週三次或以上','按次安排','稍後確認'],showIf:{field:'services',includesAny:['家居清潔']}},
      {name:'childcareDetails',label:'兒童照顧及接送安排',type:'textarea',max:1000,showIf:{field:'services',includesAny:['育兒照顧']}},
    ]},
    {title:'時間與待遇',description:'填寫預計時間與預算，讓配對更貼近安排。',fields:[
      {name:'startDate',label:'希望開始日期',type:'date',required:true},
      {name:'schedule',label:'工作日及時間',type:'textarea',required:true,hint:'例如星期一至六，上午8時至下午6時。',max:1000},
      {name:'budgetNegotiable',label:'預算尚待商議',type:'boolean'},
      {name:'budget',label:'薪金預算（港元）',type:'number',required:true,showIf:{field:'budgetNegotiable',equals:false}},
      {name:'budgetUnit',label:'預算計算方式',type:'select',required:true,options:['每月','每日','每小時','每次'],showIf:{field:'budgetNegotiable',equals:false}},
      {name:'accommodation',label:'住宿安排',type:'select',options:['獨立房間','與家庭成員共用房間','不適用','稍後安排']},
      {name:'otherRequirements',label:'其他要求',type:'textarea',max:3000},
      {name:'preferredInterviewTime',label:'方便聯絡／面試的時段',max:300},
    ]},
  ],
};
export const kindLabel = (kind: IntakeKind) => kind === 'jobseeker' ? '求職者' : '僱主';
export const allFields = (kind: IntakeKind) => sections[kind].flatMap(s => s.fields);
export type IntakeData = Record<string, string | string[] | boolean>;
export type IntakeRecord = { id: string; reference: string; kind: IntakeKind; data: IntakeData; status: string; notes: string; nextFollowUp: string; photoId?: string; requestedCandidateIds?: string[]; createdAt: string; updatedAt: string };
export function isFieldVisible(field: Field, data: IntakeData) {
  if (!field.showIf) return true;
  const value = data[field.showIf.field];
  if (field.showIf.includesAny) return Array.isArray(value) && field.showIf.includesAny.some(item => value.includes(item));
  return (value ?? false) === field.showIf.equals;
}
export function parseWorkExperiences(value: unknown): WorkExperience[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try { const rows: unknown = JSON.parse(value); return Array.isArray(rows) ? rows as WorkExperience[] : []; } catch { return []; }
}
