import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '디지털 물리 탐구실 | MUSE-AI',
  description:
    'MUSE-AI 연구회 고등 프로그램. 언덕과 공의 운동, 몸동작 AI 실습을 창의나래관 체험으로 연결합니다.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
