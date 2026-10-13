export type WorkExperience = { country: string; from: string; to: string; household: string; duties: string; leavingReason: string };
export type CandidatePublic = {
  id: string; reference: string; displayName: string; services: string[];
  nationality: string; candidateType: string; age: string; education: string;
  currentLocation: string; languages: string[]; yearsExperience: string;
  skills: string[]; employmentType: string; workLocations: string[];
  availableFrom: string; expectedSalary: string; salaryUnit: string;
  salaryNegotiable: boolean; summary: string; qualifications: string;
  workExperiences: WorkExperience[]; hasPhoto: boolean; updatedAt: string;
};
export type CandidateResults = { candidates: CandidatePublic[]; total: number; page: number; pageSize: number };
export const publicationStates = ['draft', 'published', 'paused'] as const;
export type CandidatePublication = CandidatePublic & { intakeId: string; state: typeof publicationStates[number]; consented: boolean; createdAt: string };
export const matchStages = ['待聯絡', '已推薦', '安排面試', '面試完成', '待確認', '已完成', '不合適'] as const;
export type MatchRecord = { id: string; employerId: string; jobseekerId: string; employerName: string; employerReference: string; jobseekerName: string; jobseekerReference: string; stage: typeof matchStages[number]; notes: string; interviewAt: string; createdAt: string; updatedAt: string };
export type SiteInfo = { phone: string; whatsapp: string; email: string; address: string; hours: string; fees: { service: string; amount: string; unit: string; notes: string }[]; updatedAt: string };
export const candidateTypes = ['在港完約', '在港斷約', '海外有經驗', '首次來港', '本地求職'];
export const candidateFilterKeys = ['q', 'service', 'nationality', 'candidateType', 'language', 'experience', 'employmentType', 'district', 'education', 'skill', 'ageRange', 'sort', 'page'] as const;
export const candidateAgeRanges = [
  { value: '18-29', label: '18–29歲', min: 18, max: 29 },
  { value: '30-39', label: '30–39歲', min: 30, max: 39 },
  { value: '40-49', label: '40–49歲', min: 40, max: 49 },
  { value: '50-59', label: '50–59歲', min: 50, max: 59 },
  { value: '60-100', label: '60歲或以上', min: 60, max: 100 },
] as const;
export const candidateSortOptions = [
  { value: 'newest', label: '最近更新' }, { value: 'oldest', label: '較早更新' },
  { value: 'available', label: '最快可到職' },
  { value: 'salary-asc', label: '期望薪金：低至高' }, { value: 'salary-desc', label: '期望薪金：高至低' },
  { value: 'age-asc', label: '年齡：小至大' }, { value: 'age-desc', label: '年齡：大至小' },
] as const;
export const formatWorkExperience = (entries: WorkExperience[]) => entries.map((entry, index) => [
  `工作${index + 1}｜${entry.country} ${entry.from}${entry.to ? ` 至 ${entry.to}` : ' 至今'}`,
  entry.household && `家庭情況：${entry.household}`, entry.duties && `主要工作：${entry.duties}`,
  entry.leavingReason && `離職原因：${entry.leavingReason}`,
].filter(Boolean).join('\n')).join('\n\n');
