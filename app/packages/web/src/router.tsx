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
const Leaflet = lazy(() => import('@/routes/patient/Leaflet'))
const Profile = lazy(() => import('@/routes/patient/Profile'))
const Account = lazy(() => import('@/routes/patient/Account'))
const HealthInfo = lazy(() => import('@/routes/patient/HealthInfo'))
const Records = lazy(() => import('@/routes/patient/Records'))
const MyDoctor = lazy(() => import('@/routes/patient/MyDoctor'))
const Settings = lazy(() => import('@/routes/patient/Settings'))
const PasswordSettings = lazy(() => import('@/routes/patient/PasswordSettings'))
const NotFound = lazy(() => import('@/routes/patient/NotFound'))
const Insight = lazy(() => import('@/routes/doctor/Insight'))
const DoctorLogin = lazy(() => import('@/routes/doctor/DoctorLogin'))

const page = (node: ReactElement) => <Suspense fallback={<RouteFallback />}>{node}</Suspense>

/**
 * 路由表（技术方案 §8 / 任务书 T8；G7 增补登录；specs/25 医生端独立登录入口）。
 *
 * - `/login`：患者端登录；`/doctor/login`：医生端专用登录入口（公开路由，未登录可达）；
 * - 患者端挂在 `<RequireAuth />` 下（未登录跳 /login，demo 模式直接放行）；
 * - `/doctor/*` 挂在 `<RequireAuth loginPath="/doctor/login" requireDoctor />` 下：
 *   未登录跳医生端登录页；password 模式下非医生账号跳回医生端登录页并提示（demo 模式旁路）；
 * - 患者端 PatientLayout（底部导航 5 项）；医生端 DoctorLayout（独立分支，无底部导航）；
 * - `/my-doctor`：患者端「我的医生」独立页（specs/25 绑定卡片从设置页迁出，入口在「我的」页）；
 * - `/password`：患者端「登录密码」独立页（2026-11-19 从「设置 → 账号与安全」上移，入口在「我的」页）。
 */
export const router = createBrowserRouter([
  { path: '/login', element: page(<Login />) },
  { path: '/doctor/login', element: page(<DoctorLogin />) },
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
          { path: '/leaflet/:drugId', element: page(<Leaflet />) },
          { path: '/profile', element: page(<Profile />) },
          { path: '/account', element: page(<Account />) },
          { path: '/health-info', element: page(<HealthInfo />) },
          { path: '/records', element: page(<Records />) },
          { path: '/my-doctor', element: page(<MyDoctor />) },
          { path: '/settings', element: page(<Settings />) },
          // 登录密码自 2026-11-19 起从「设置 → 账号与安全」上移到「我的」页，路径随之提到一级
          // （与 /my-doctor 同形，App 侧也叫 /password）。
          { path: '/password', element: page(<PasswordSettings />) },
          { path: '*', element: page(<NotFound />) },
        ],
      },
    ],
  },
  {
    // 医生端：独立登录入口 + 角色闸门（specs/25；权限最终以服务端 403 兜底）。
    element: <RequireAuth loginPath="/doctor/login" requireDoctor />,
    children: [
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
