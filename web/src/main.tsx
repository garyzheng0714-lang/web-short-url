import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { MotionConfig } from "motion/react";
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "./styles.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { consumeSessionTokenFromHash } from "./lib/session";
import { AppShell } from "./app/shell";
import { Spinner } from "@/components/ui/spinner";

// 页面按路由拆包：首屏只装当前页
const LinksPage = lazy(() => import("./pages/links").then((m) => ({ default: m.LinksPage })));
const LinkDetailPage = lazy(() => import("./pages/link-detail").then((m) => ({ default: m.LinkDetailPage })));
const OverviewPage = lazy(() => import("./pages/overview").then((m) => ({ default: m.OverviewPage })));
const GroupsPage = lazy(() => import("./pages/groups").then((m) => ({ default: m.GroupsPage })));
const GroupDetailPage = lazy(() => import("./pages/group-detail").then((m) => ({ default: m.GroupDetailPage })));
const SettingsPage = lazy(() => import("./pages/settings").then((m) => ({ default: m.SettingsPage })));
const Loading = () => (
  <div className="grid h-64 place-items-center">
    <Spinner delay={400} label="正在加载页面" />
  </div>
);
const page = (el: React.ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

// 登录回跳带 #session_token：先消费再渲染，所有请求才带得上 X-Session-Token
consumeSessionTokenFromHash();

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: page(<LinksPage />) },
      { path: "links/:id", element: page(<LinkDetailPage />) },
      { path: "overview", element: page(<OverviewPage />) },
      { path: "groups", element: page(<GroupsPage />) },
      { path: "groups/:id", element: page(<GroupDetailPage />) },
      { path: "settings", element: page(<SettingsPage />) },
      { path: "*", element: <Navigate replace to="/" /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  </React.StrictMode>
);
