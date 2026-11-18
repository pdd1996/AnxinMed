import { lazy, Suspense, type ReactElement } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { PatientLayout } from '@/components/layout/PatientLayout'
import { DoctorLayout } from '@/components/layout/DoctorLayout'
import { RouteFallback } from '@/components/layout/RouteFallback'

// 懒加载分段（技术方案 §8）：各页按需拆分，首屏只加载骨架 + 当前页。
const Login = lazy(() => import('@/routes/Login'))
const Home = lazy(() => import('@/routes/patient/Home'))
const Box = lazy(() => import('@/routes/patient/Box'))
const IntakeRx = lazy(() => import('@/routes/patient/IntakeRx'))
const IntakeDrug = lazy(() => import('@/routes/patient/IntakeDrug'))
const Draft = lazy(() => import('@/routes/patient/Draft'))
const Consult = lazy(() => import('@/routes/patient/Consult'))
const Profile = lazy(() => import('@/routes/patient/Profile'))
const Account = lazy(() => import('@/routes/patient/Account'))
const HealthInfo = lazy(() => import('@/routes/patient/HealthInfo'))
const Records = lazy(() => import('@/routes/patient/Records'))
const Settings = lazy(() => import('@/routes/patient/Settings'))
const NotFound = lazy(() => import('@/routes/patient/NotFound'))
const Insight = lazy(() => import('@/routes/doctor/Insight'))

const page = (node: ReactElement) => <Suspense fallback={<RouteFallback />}>{node}</Suspense>

/**
 * 路由表（技术方案 §8 / 任务书 T8；G7 增补登录）。
 * /login 在守卫之外；患者端/医生端挂在 RequireAuth 之下（未登录跳 /login，demo 模式直接放行）。
 * 患者端患者布局 PatientLayout（底部导航 5 项）；/doctor/* 挂 DoctorLayout（独立分支，无底部导航）。
 */
export const router = createBrowserRouter([
  { path: '/login', element: page(<Login />) },
  {
    element: <RequireAuth />,
    children: [
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
          { path: '/account', element: page(<Account />) },
          { path: '/health-info', element: page(<HealthInfo />) },
          { path: '/records', element: page(<Records />) },
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
    ],
  },
])
