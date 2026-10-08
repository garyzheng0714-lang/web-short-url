import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useParams } from "react-router-dom";
import { MotionConfig } from "motion/react";
import "@fontsource-variable/inter";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "./styles.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Spinner } from "@/components/ui/spinner";
import { consumeSessionTokenFromHash } from "./lib/session";
import { AppShell } from "./app/shell";
import { HomePage } from "./pages/home";

const SettingsPage = lazy(() => import("./pages/settings").then((m) => ({ default: m.SettingsPage })));
const Loading = () => (
  <div className="grid h-64 place-items-center">
    <Spinner delay={400} label="正在加载页面" />
  </div>
);
const page = (el: React.ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

// 旧地址统一收进首页：详情、分组都是首页上的抽屉
function LinkRedirect() {
  return <Navigate replace to={`/?link=${encodeURIComponent(useParams().id || "")}`} />;
}
function GroupRedirect() {
  return <Navigate replace to={`/?view=groups&g=${encodeURIComponent(useParams().id || "")}`} />;
}

consumeSessionTokenFromHash();

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: page(<HomePage />) },
      { path: "settings", element: page(<SettingsPage />) },
      { path: "links/:id", element: <LinkRedirect /> },
      { path: "groups/:id", element: <GroupRedirect /> },
      { path: "groups", element: <Navigate replace to="/?view=groups" /> },
      { path: "overview", element: <Navigate replace to="/" /> },
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
