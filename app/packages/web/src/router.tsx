import { lazy, Suspense, type ReactElement } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { PatientLayout } from '@/components/layout/PatientLayout'
import { DoctorLayout } from '@/components/layout/DoctorLayout'
import { RouteFallback } from '@/components/layout/RouteFallback'

// 懒加载分段（技术方案 §8）：各页按需拆分，首屏只加载骨架 + 当前页。
const Home = lazy(() => import('@/routes/patient/Home'))
const Box = lazy(() => import('@/routes/patient/Box'))
const IntakeRx = lazy(() => import('@/routes/patient/IntakeRx'))
const IntakeDrug = lazy(() => import('@/routes/patient/IntakeDrug'))
const Draft = lazy(() => import('@/routes/patient/Draft'))
const Consult = lazy(() => import('@/routes/patient/Consult'))
const Profile = lazy(() => import('@/routes/patient/Profile'))
const Settings = lazy(() => import('@/routes/patient/Settings'))
const NotFound = lazy(() => import('@/routes/patient/NotFound'))
const Insight = lazy(() => import('@/routes/doctor/Insight'))

const page = (node: ReactElement) => <Suspense fallback={<RouteFallback />}>{node}</Suspense>

/**
 * 路由表（技术方案 §8 / 任务书 T8）。
 * 患者端挂 PatientLayout（底部导航 5 项）；/doctor/* 挂 DoctorLayout（独立分支，无底部导航）。
 */
export const router = createBrowserRouter([
  {
    element: <PatientLayout />,
    children: [
      { path: '/', element: page(<Home />) },
      { path: '/box', element: page(<Box />) },
      { path: '/intake/rx', element: page(<IntakeRx />) },
      { path: '/intake/drug', element: page(<IntakeDrug />) },
      { path: '/drafts/:id', element: page(<Draft />) },
      { path: '/consult', element: page(<Consult />) },
      { path: '/profile', element: page(<Profile />) },
      { path: '/settings', element: page(<Settings />) },
      { path: '*', element: page(<NotFound />) },
    ],
  },
  {
    path: '/doctor',
    element: <DoctorLayout />,
    children: [
      { index: true, element: <Navigate to="/doctor/insight" replace /> },
      { path: 'insight', element: page(<Insight />) },
    ],
  },
])
