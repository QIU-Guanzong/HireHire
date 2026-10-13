import type { Metadata } from 'next';
import PrivateAdminSettings from '@/components/private-admin-settings';
export const metadata:Metadata={title:'聯絡與收費設定'};
export default function Settings(){return <PrivateAdminSettings/>;}
