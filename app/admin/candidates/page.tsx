import type { Metadata } from 'next';
import PrivateAdminCandidates from '@/components/private-admin-candidates';
export const metadata:Metadata={title:'人選管理',robots:{index:false,follow:false}};
export default function Page(){return <PrivateAdminCandidates/>;}
