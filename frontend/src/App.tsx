import React, { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import SharedLayout from "./components/SharedLayout";

// The landing route ships in the entry chunk. Splitting it out meant the browser
// had to fetch a second chunk after parsing the entry, and the Suspense fallback
// below showed through as a blank page for that round trip. It is small; the
// heavy routes are what actually needed splitting.
import Index from "./pages/Index";
// Login ships with the entry too: ProtectedRoute redirects here, and fetching a
// separate 3 kB chunk mid-redirect left the page empty for another round trip.
import Login from "./pages/Login";

// Split per route. ag-grid is ~47% of the bundle and recharts another ~17%, yet
// each is used on a single route — loading both up front made every visitor pay
// for the whole app before the landing page could paint.
const SubmitContent = lazy(() => import("./pages/SubmitContent"));
const TrackStatus = lazy(() => import("./pages/TrackStatus"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Profile = lazy(() => import("./pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));
// One study's curation record at its own URL, so it can be cited from a paper,
// an email or DataHub rather than only reached by expanding a grid row.
const StudyRecord = lazy(() => import("./pages/StudyRecord"));

const queryClient = new QueryClient();

const App: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        {/* The shell, not a spinner and not a blank page. Header and Footer are
            already in the entry chunk, so on a cold load of a heavy route they
            can paint while its chunk is still downloading — on /track-status
            that is ~0.5s during which the page used to be white for no reason.
            On in-app navigation this keeps the header and footer in place
            instead of flashing the viewport, which is what the blank fallback
            was originally reaching for. */}
        <Suspense fallback={<SharedLayout><div style={{ minHeight: "60vh" }} /></SharedLayout>}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />

          {/* Protected Route - Requires Login */}
          <Route 
            path="/submit" 
            element={
              <ProtectedRoute>
                <SubmitContent />
              </ProtectedRoute>
            } 
          />
          
          <Route path="/track-status" element={<TrackStatus />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route path="/study/:id" element={<StudyRecord />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
