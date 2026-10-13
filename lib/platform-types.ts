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
export const candidateFilterKeys = ['q', 'service', 'nationality', 'candidateType', 'language', 'experience', 'employmentType', 'district', 'sort', 'page'] as const;
export const formatWorkExperience = (entries: WorkExperience[]) => entries.map((entry, index) => [
  `工作${index + 1}｜${entry.country} ${entry.from}${entry.to ? ` 至 ${entry.to}` : ' 至今'}`,
  entry.household && `家庭情況：${entry.household}`, entry.duties && `主要工作：${entry.duties}`,
  entry.leavingReason && `離職原因：${entry.leavingReason}`,
].filter(Boolean).join('\n')).join('\n\n');
