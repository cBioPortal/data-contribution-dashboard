import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import SharedLayout from "@/components/SharedLayout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FileText, Info, ArrowRight, ExternalLink, CheckCircle, LogIn, Clock, Search, Database, FlaskConical, AlertTriangle, ChevronDown } from "lucide-react";
import { submitContent } from "@/services/api";
import { Submission } from "@/types/submission";

type PublicationType = "published" | "preprint" | null;
type ActionType = "suggest-paper" | "submit-data" | null;
type SharingPreference = "public" | "private";

type CommonFormValues = {
  name: string;
  email: string;
  wantsNotification: string;
  canContactEmail: boolean | null;
  alternativeEmail: string;
  notes: string;
  dataTypes: string[];
  otherDataType: string;
};

type PaperFormValues = CommonFormValues & {
  paperTitle: string;
  pmid: string;
  journal: string;
  authors: string;
  publicationYear: string;
  isLeadAuthor: boolean | null;
  wantsToHelpCurate: string;
};

type DataFormValues = CommonFormValues & {
  studyName: string;
  description: string;
  associatedPaper: string;
  linkToData: string;
  accessGranted: boolean;
  isDataTransformed: boolean | null;
  referenceGenome: string;
};

// Curation team account that submitters must grant data access to.
const CURATION_EMAIL = "cdsicuration@mskcc.org";

/**
 * Data-sharing block: instructions for sharing data via an external link
 * (Google Drive / Dropbox / Box) with view access granted to the curation team,
 * a link input, and a confirmation checkbox.
 */
const DataSharingFields = ({
  control,
  required,
  linkLabel,
}: {
  control: any;
  required: boolean;
  linkLabel: string;
}) => {
  const [showHowTo, setShowHowTo] = useState(false);

  return (
    <>
      {/* Link to data */}
      <FormField
        control={control}
        name="linkToData"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-gray-700">
              {linkLabel} {required && <span className="text-red-500">*</span>}{" "}
              <button
                type="button"
                onClick={() => setShowHowTo((v) => !v)}
                className="text-blue-600 hover:text-blue-800 inline-flex items-center font-normal"
                aria-expanded={showHowTo}
              >
                How do I share?
                <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${showHowTo ? "rotate-180" : ""}`} />
              </button>
            </FormLabel>
            {showHowTo && (
              <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <li>Upload your data to Google Drive, Dropbox, Box, or a similar service.</li>
                <li>
                  Grant <span className="font-medium">view access</span> to{" "}
                  <span className="font-semibold text-blue-700">{CURATION_EMAIL}</span>.
                </li>
                <li>Paste the shareable link below.</li>
              </ol>
            )}
            <FormControl>
              <Input
                placeholder="Paste your data link (e.g., Google Drive, Dropbox, Box)"
                className="shadow-sm"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Access-granted confirmation */}
      <FormField
        control={control}
        name="accessGranted"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="access-granted"
                checked={field.value === true}
                onCheckedChange={(v) => field.onChange(v === true)}
              />
              <Label htmlFor="access-granted" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                I have granted data access to{" "}
                <span className="font-semibold text-blue-700">{CURATION_EMAIL}</span>
                {required && <span className="text-red-500"> *</span>}
              </Label>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
};

type FormValues = PaperFormValues & DataFormValues & {
  publicationType: PublicationType;
  actionType: ActionType;
  sharingPreference: SharingPreference;
  privateAccessEmails?: string;
};

const SubmitContent = () => {
  const [conflictError, setConflictError] = useState<null | {
    conflictType: string;
    message: string;
    existingSubmissionId: string;
    existingSubmissionType: string;
    existingTitle: string;
    existingStatus: string;
    similarityScore?: number;
  }>(null);
  const [pendingSubmitData, setPendingSubmitData] = useState<{ data: FormValues } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Set default values immediately
  const [publicationType, setPublicationType] = useState<PublicationType>("published");
  const [actionType, setActionType] = useState<ActionType>("suggest-paper");
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [submittedActionType, setSubmittedActionType] = useState<ActionType>("suggest-paper");
  const [countdown, setCountdown] = useState(20);
  const [redirectTab, setRedirectTab] = useState("");
  const redirectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();
  const isLoggedIn = !!localStorage.getItem('authToken');

  const doRedirect = (tab: string) => {
    if (redirectTimerRef.current) clearInterval(redirectTimerRef.current);
    setShowSuccessModal(false);
    navigate(tab || "/track-status");
  };

  useEffect(() => {
    if (!showSuccessModal) return;
    setCountdown(20);
    redirectTimerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(redirectTimerRef.current!);
          setShowSuccessModal(false);
          navigate(redirectTab || "/track-status");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (redirectTimerRef.current) clearInterval(redirectTimerRef.current); };
  }, [showSuccessModal]);
  
  const form = useForm<FormValues>({
    defaultValues: {
      publicationType: "published",
      actionType: "suggest-paper",
      sharingPreference: "public",
      name: "",
      email: "",
      wantsNotification: "",
      canContactEmail: null,
      alternativeEmail: "",
      paperTitle: "",
      pmid: "",
      journal: "",
      authors: "",
      publicationYear: "",
      isLeadAuthor: null,
      wantsToHelpCurate: "",
      studyName: "",
      description: "",
      associatedPaper: "",
      linkToData: "",
      accessGranted: false,
      isDataTransformed: null,
      referenceGenome: "",
      notes: "",
      dataTypes: [],
      otherDataType: "",
      privateAccessEmails: "",
    },
  });
  
  const canContactEmail = form.watch("canContactEmail");
  const isDataTransformed = form.watch("isDataTransformed");
  const linkToData = form.watch("linkToData");
  const accessGranted = form.watch("accessGranted");
  const dataTypes = form.watch("dataTypes");
  const isOtherSelected = dataTypes?.includes("Other (please specify)");
  const isLeadAuthor = form.watch("isLeadAuthor");
  const wantsToHelpCurate = form.watch("wantsToHelpCurate");
  const sharingPreference = form.watch("sharingPreference");

  const handleDataTypeChange = (dataType: string, checked: boolean) => {
    const currentDataTypes = form.getValues("dataTypes") || [];
    if (checked) {
      form.setValue("dataTypes", [...currentDataTypes, dataType]);
    } else {
      form.setValue("dataTypes", currentDataTypes.filter(type => type !== dataType));
      if (dataType === "Other (please specify)") {
        form.setValue("otherDataType", "");
      }
    }
  };

  const onSubmit = async (data: FormValues) => {
    // Validate alternative email if contact permission is No (for both paper and data forms)
    if (data.canContactEmail === false && !data.alternativeEmail.trim()) {
      toast.error("Please provide an alternative contact email");
      return;
    }

    if (!data.name?.trim()) {
      toast.error("Please provide your name.");
      return;
    }

    if (!data.email?.trim()) {
      toast.error("Please provide your email.");
      return;
    }

    // Data submissions (and all preprints) must share a data link and confirm
    // that the curation team has been granted access to it.
    const needsDataLink = data.actionType === "submit-data" || publicationType === "preprint";
    if (needsDataLink) {
      if (!data.linkToData?.trim()) {
        toast.error("Please provide a link to your data (Google Drive, Dropbox, Box, etc.).");
        return;
      }
      if (!data.accessGranted) {
        toast.error(`Please confirm you have granted data access to ${CURATION_EMAIL}.`);
        return;
      }
    } else if (data.linkToData?.trim() && !data.accessGranted) {
      // Paper suggestions: a link is optional, but if one is given, access must be confirmed.
      toast.error(`Please confirm you have granted data access to ${CURATION_EMAIL}.`);
      return;
    }

    setIsSubmitting(true);

    try {
      // 🔥 ACTUAL API CALL - This is what was missing!
      const response = await submitContent(data);
      console.log('✅ Submission successful:', response);
      
      // Set success message based on action type
      if (data.actionType === "suggest-paper") {
        setSuccessMessage("Your study suggestion has been submitted successfully!");
      } else {
        setSuccessMessage("Your dataset has been submitted successfully!");
      }
      
      // Store redirect destination and submitted action type before reset
      const tab = data.actionType === "suggest-paper"
        ? "/track-status?tab=suggested-papers"
        : "/track-status?tab=submitted-data";
      setRedirectTab(tab);
      setSubmittedActionType(data.actionType);

      // Reset form
      form.reset();
      setPublicationType("published");
      setActionType("suggest-paper");

      // Show success modal (countdown + redirect handled by useEffect)
      setShowSuccessModal(true);
      
    } catch (error: any) {
      if (error.isConflict) {
        setConflictError({
          conflictType: error.conflictType,
          message: error.message,
          existingSubmissionId: error.existingSubmissionId,
          existingSubmissionType: error.existingSubmissionType,
          existingTitle: error.existingTitle,
          existingStatus: error.existingStatus,
          similarityScore: error.similarityScore,
        });
        // Save pending data for "Submit Anyway" on soft warnings
        if (error.conflictType === 'similar-title') {
          setPendingSubmitData({ data });
        }
        // Scroll to top of form so the banner is visible
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        toast.error(error.message || "Failed to submit");
      }
      console.error("Error submitting form:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Fields to reset when switching between form types (does NOT reset actionType)
  const handleSubmitAnyway = async () => {
    if (!pendingSubmitData) return;
    setIsSubmitting(true);
    setConflictError(null);
    try {
      const response = await submitContent(pendingSubmitData.data, true);
      console.log('✅ Submission successful (override):', response);
      if (pendingSubmitData.data.actionType === 'suggest-paper') {
        setSuccessMessage('Your study suggestion has been submitted successfully!');
      } else {
        setSuccessMessage('Your dataset has been submitted successfully!');
      }
      const tab = pendingSubmitData.data.actionType === 'suggest-paper'
        ? '/track-status?tab=suggested-papers'
        : '/track-status?tab=submitted-data';
      setRedirectTab(tab);
      setSubmittedActionType(pendingSubmitData.data.actionType);
      form.reset();
      setPublicationType('published');
      setActionType('suggest-paper');
      setPendingSubmitData(null);
      setShowSuccessModal(true);
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetDataFields = () => {
    form.setValue("isDataTransformed", null);
    form.setValue("studyName", "");
    form.setValue("description", "");
    form.setValue("associatedPaper", "");
    form.setValue("linkToData", "");
    form.setValue("referenceGenome", "");
    form.setValue("dataTypes", []);
    form.setValue("otherDataType", "");
    form.setValue("notes", "");
    form.setValue("isLeadAuthor", null);
    form.setValue("canContactEmail", null);
    form.setValue("alternativeEmail", "");
    form.setValue("wantsToHelpCurate", "");
    form.setValue("paperTitle", "");
    form.setValue("pmid", "");
    form.setValue("journal", "");
    form.setValue("authors", "");
    form.setValue("publicationYear", "");
    form.setValue("privateAccessEmails", "");
    form.setValue("linkToData", "");
    form.setValue("accessGranted", false);
  };

  // Update the publication type when radio selection changes
  const handlePublicationTypeChange = (value: PublicationType) => {
    setPublicationType(value);
    form.setValue("publicationType", value);
    resetDataFields();
    if (value === "preprint") {
      // preprint has no action type choice — force submit-data
      setActionType("submit-data");
      form.setValue("actionType", "submit-data");
    } else if (value === "published") {
      // restore default action type when returning to published
      setActionType("suggest-paper");
      form.setValue("actionType", "suggest-paper");
    }
  };

  // Update the action type when radio selection changes
  const handleActionTypeChange = (value: ActionType) => {
    setActionType(value);
    form.setValue("actionType", value);
    resetDataFields();
  };

  // Check if submit should be disabled
  const needsDataTransformed = actionType === "submit-data" || publicationType === "preprint";
  const isSubmitDisabled = isSubmitting || (needsDataTransformed && isDataTransformed !== true);

  // Data types for both forms
  const paperDataTypes = [
    "Clinical",
    "Mutation Data (SNVs/Indels)",
    "Copy Number Alterations (Discrete or Segmented)",
    "Gene Expression (mRNA)",
    "Protein Expression (RPPA, Mass Spec)",
    "Fusion / Structural Variants",
    "Methylation Data",
    "Survival / Outcome Data",
    "Immune Profiling (Neoantigens, Immune Cell Infiltration)",
    "Imaging / Pathology Data",
    "Single-cell Data (scRNA-seq, spatial)",
    "Other (please specify)"
  ];

  const dataFormDataTypes = [
    "Clinical",
    "Mutation Data (SNVs/Indels)",
    "Copy Number Alterations (Discrete or Segmented)",
    "Gene Expression (mRNA)",
    "Protein Expression (RPPA, Mass Spec)",
    "Fusion / Structural Variants",
    "Methylation Data",
    "Survival / Outcome Data",
    "Immune Profiling (Neoantigens, Immune Cell Infiltration)",
    "Imaging / Pathology Data",
    "Single-cell Data (scRNA-seq, spatial)",
    "Other (please specify)"
  ];

  return (
    <SharedLayout>
      <div className="min-h-screen bg-gradient-to-b from-blue-50/50 to-white py-8">
        <div className="mx-auto w-full max-w-5xl px-6">
          {/* Header */}
          <div className="mb-6 text-center">
            <div className="inline-flex items-center justify-center p-2 mb-3 bg-blue-100 rounded-full">
              <FileText className="h-7 w-7 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold mb-2 text-gray-800">Submit to cBioPortal</h1>
            <p className="text-base text-gray-600 max-w-3xl mx-auto">
              Contribute to cBioPortal by suggesting datasets and submitting data, published or pre-print.
            </p>
          </div>

          {/* Login required banner */}
          {!isLoggedIn && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-4">
              <LogIn className="h-6 w-6 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-amber-800">You need to be logged in to submit</p>
                <p className="text-sm text-amber-700 mt-1">You can browse the form, but you'll need to <a href="/login" className="underline font-medium">log in</a> before your submission can be saved.</p>
              </div>
            </div>
          )}

          {/* What happens after you submit - compact one-liner */}
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 flex items-center gap-2 text-sm text-blue-800">
            <Clock className="h-4 w-4 text-blue-500 flex-shrink-0" />
            <span>Submissions are reviewed within <span className="font-semibold">2–6 weeks</span>. You can follow progress on the <a href="/track-status" className="underline font-medium">Track Status</a> page.</span>
          </div>

          {/* Conflict / duplicate banner */}
          {conflictError && (() => {
            const isDataConflict = conflictError.conflictType === 'data-submission-exists';
            const isSimilarTitle = conflictError.conflictType === 'similar-title';
            const shortId = conflictError.existingSubmissionId?.replace(/^submission_/, '').replace(/^github_/, '').slice(0, 8);
            const trackerTab = conflictError.existingSubmissionType === 'submit-data' ? 'submitted-data' : 'suggested-papers';
            const bannerColor = isDataConflict ? 'red' : 'amber';
            return (
              <div className={`mb-6 rounded-xl border p-5 flex items-start gap-4 ${
                isDataConflict
                  ? 'bg-red-50 border-red-200'
                  : 'bg-amber-50 border-amber-200'
              }`}>
                <AlertTriangle className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                  isDataConflict ? 'text-red-500' : 'text-amber-500'
                }`} />
                <div className="flex-1">
                  <p className={`font-semibold text-sm ${
                    isDataConflict ? 'text-red-800' : 'text-amber-800'
                  }`}>
                    {isDataConflict
                      ? 'A data submission for this study already exists'
                      : isSimilarTitle
                        ? 'A similar study may already exist'
                        : 'This study has already been suggested'}
                  </p>
                  <p className={`text-sm mt-1 ${
                    isDataConflict ? 'text-red-700' : 'text-amber-700'
                  }`}>
                    {conflictError.existingTitle && (
                      <span className="block font-medium">{conflictError.existingTitle}</span>
                    )}
                    {conflictError.existingStatus && (
                      <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                        isDataConflict ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>{conflictError.existingStatus}</span>
                    )}
                  </p>
                  <div className="flex items-center gap-3 mt-3">
                    <a
                      href={`/track-status?tab=${trackerTab}&highlight=${shortId}`}
                      className={`text-sm font-medium underline ${
                        isDataConflict ? 'text-red-700 hover:text-red-900' : 'text-amber-700 hover:text-amber-900'
                      }`}
                    >
                      View in tracker →
                      {shortId && <span className="ml-1 font-mono text-xs opacity-70">#{shortId}</span>}
                    </a>
                    {isSimilarTitle && (
                      <button
                        type="button"
                        onClick={handleSubmitAnyway}
                        disabled={isSubmitting}
                        className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded-md transition-colors disabled:bg-gray-400"
                      >
                        {isSubmitting ? 'Submitting...' : 'Submit Anyway'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setConflictError(null); setPendingSubmitData(null); }}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Main Form Card */}
          <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100">
            <div className="p-6 md:p-8">
              
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                  
                  {/* Section 1: Publication Type Selection */}
                  <div>
                    <h2 className="text-lg font-semibold mb-4 text-gray-800">1. What type of study are you submitting?</h2>
                    <RadioGroup
                      value={publicationType ?? ""}
                      onValueChange={handlePublicationTypeChange}
                      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                    >
                      <div className={`flex items-center space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer ${
                        publicationType === "published" 
                          ? "border-blue-500 bg-blue-50" 
                          : "border-gray-200 hover:border-gray-300 bg-white"
                      }`}>
                        <RadioGroupItem value="published" id="published" className="h-5 w-5" />
                        <Label htmlFor="published" className="cursor-pointer text-gray-700 flex-1">
                          <span className="font-medium text-base block">Published / Public Study</span>
                          <span className="text-xs text-gray-400 font-normal">A peer-reviewed paper, public dataset, or consortium resource that is already publicly available.</span>
                        </Label>
                      </div>
                      <div className={`flex items-center space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer ${
                        publicationType === "preprint" 
                          ? "border-blue-500 bg-blue-50" 
                          : "border-gray-200 hover:border-gray-300 bg-white"
                      }`}>
                        <RadioGroupItem value="preprint" id="preprint" className="h-5 w-5" />
                        <Label htmlFor="preprint" className="cursor-pointer text-gray-700 flex-1">
                          <span className="font-medium text-base block">Pre-publication</span>
                          <span className="text-xs text-gray-400 font-normal">Data from an unpublished or embargoed study — share privately with your team or make publicly available ahead of publication.</span>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Section 2: Action Type (Only for Published Papers) */}
                  {publicationType === "published" && (
                    <div>
                      <h2 className="text-lg font-semibold mb-4 text-gray-800">2. Would you like to suggest a study or submit data?</h2>
                      <RadioGroup
                        value={actionType ?? ""}
                        onValueChange={handleActionTypeChange}
                        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                      >
                        <div className={`flex items-start space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer ${
                          actionType === "suggest-paper" 
                            ? "border-blue-500 bg-blue-50" 
                            : "border-gray-200 hover:border-gray-300 bg-white"
                        }`}>
                          <RadioGroupItem value="suggest-paper" id="suggest-paper" className="mt-0.5 shrink-0 flex items-center justify-center" />
                          <Label htmlFor="suggest-paper" className="cursor-pointer text-gray-700 flex-1 leading-snug">
                            <span className="font-medium text-sm block">Suggest a Study for Curation</span>
                            <span className="text-xs text-gray-400 font-normal leading-relaxed">Know of a published paper, public dataset, or consortium resource (e.g. TCGA, ICGC) that should be in cBioPortal? Our team will handle the data preparation.</span>
                          </Label>
                        </div>
                        <div className={`flex items-start space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer ${
                          actionType === "submit-data" 
                            ? "border-blue-500 bg-blue-50" 
                            : "border-gray-200 hover:border-gray-300 bg-white"
                        }`}>
                          <RadioGroupItem value="submit-data" id="submit-data" className="mt-0.5 shrink-0 flex items-center justify-center" />
                          <Label htmlFor="submit-data" className="cursor-pointer text-gray-700 flex-1 leading-snug">
                            <span className="font-medium text-sm block">Submit Formatted Data</span>
                            <span className="text-xs text-gray-400 font-normal leading-relaxed">You have data already formatted to cBioPortal standards and want to upload it directly for review.</span>
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>
                  )}

                  {/* Sharing Preference for Pre-prints */}
                  {publicationType === "preprint" && (
                    <div>
                      <h2 className="text-lg font-semibold mb-2 text-gray-800">2. How would you like to share your pre-print data?</h2>
                      <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                        <p><span className="font-semibold">Not published yet?</span> You can still submit your data before publication. Choose <span className="font-medium">private</span> to review it in a password-protected cBioPortal instance visible only to your team — useful for manuscript preparation or peer review. Choose <span className="font-medium">public</span> to make it immediately accessible to anyone.</p>
                      </div>
                      <FormField
                        control={form.control}
                        name="sharingPreference"
                        render={({ field }) => (
                          <FormItem>
                            <RadioGroup
                              value={field.value}
                              onValueChange={field.onChange}
                              className="space-y-3"
                            >
                              <div className={`flex items-start space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer ${
                                field.value === "public"
                                  ? "border-blue-500 bg-blue-50"
                                  : "border-gray-200 hover:border-gray-300 bg-white"
                              }`}>
                                <RadioGroupItem value="public" id="public" className="mt-1" />
                                <Label htmlFor="public" className="text-gray-700 cursor-pointer font-normal leading-snug flex-1">
                                  Make it publicly available
                                </Label>
                              </div>
                              <div className={`flex items-start space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer ${
                                field.value === "private"
                                  ? "border-blue-500 bg-blue-50"
                                  : "border-gray-200 hover:border-gray-300 bg-white"
                              }`}>
                                <RadioGroupItem value="private" id="private" className="mt-1" />
                                <Label htmlFor="private" className="text-gray-700 cursor-pointer font-normal leading-snug flex-1">
                                  Keep it private for now (review in private cBioPortal)
                                </Label>
                              </div>
                            </RadioGroup>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {sharingPreference === "private" && (
                        <div className="mt-4">
                          <FormField
                            control={form.control}
                            name="privateAccessEmails"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-gray-700 font-normal">
                                  Emails of team members (Google-authenticated) who need access:
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    type="text"
                                    placeholder="Enter email addresses separated by commas"
                                    className="shadow-sm"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sections 3, 4 + Submit: only show once a form path is selected */}
                  {(actionType !== null || publicationType === "preprint") && (<>
                  <div className="space-y-6">
                    <h2 className="text-lg font-semibold text-gray-800">
                      3. {actionType === "suggest-paper" ? "Study Information" : "Dataset Information"}
                    </h2>

                    {/* Paper Suggestion Form Fields */}
                    {actionType === "suggest-paper" && publicationType === "published" && (
                      <>
                        {/* PMID or Link to the Paper */}
                        <FormField
                          control={form.control}
                          name="pmid"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700">
                                PMID or Link to the Study <span className="text-red-500">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="PMID, DOI, or URL"
                                  className="shadow-sm"
                                  required
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Paper Title */}
                        <FormField
                          control={form.control}
                          name="paperTitle"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700">Study Title</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Enter the full title of the study"
                                  className="shadow-sm"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Journal */}
                        <FormField
                          control={form.control}
                          name="journal"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700">Journal / Source</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="e.g. Nature, GEO, TCGA portal"
                                  className="shadow-sm"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Authors + Year on same row */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <FormField
                            control={form.control}
                            name="authors"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-gray-700">Authors</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="e.g. Smith J, Jones A, et al."
                                    className="shadow-sm"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="publicationYear"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-gray-700">Publication Year</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="e.g. 2024"
                                    className="shadow-sm"
                                    maxLength={4}
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* Data Types Available for Paper Form */}
                        <div>
                          <div className="flex items-center mb-3">
                            <FormLabel className="text-gray-700">Available Data Types</FormLabel>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="w-4 h-4 text-gray-500 ml-2 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-sm">
                                    What data does the submission contain?
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 bg-gray-50 p-4 rounded-lg border border-gray-200">
                            {paperDataTypes.map((dataType) => (
                              <div key={dataType} className="flex items-start space-x-2">
                                <Checkbox
                                  id={`data-type-${dataType.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                                  checked={dataTypes?.includes(dataType) || false}
                                  onCheckedChange={(checked) => handleDataTypeChange(dataType, checked as boolean)}
                                  className="mt-1"
                                />
                                <Label htmlFor={`data-type-${dataType.toLowerCase().replace(/[^a-z0-9]/g, '-')}`} className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                  {dataType}
                                </Label>
                              </div>
                            ))}
                          </div>
                          {isOtherSelected && (
                            <div className="mt-4">
                              <FormField
                                control={form.control}
                                name="otherDataType"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input
                                        placeholder="Please specify other data type"
                                        className="shadow-sm"
                                        {...field}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                          )}
                        </div>

                        {/* Optional supporting-data link for Paper Form */}
                        <DataSharingFields
                          key="paper"
                          control={form.control}
                          required={false}
                          linkLabel="Link to supporting data (optional)"
                        />

                        {/* Researcher question */}
                        <FormField
                          control={form.control}
                          name="isLeadAuthor"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700">
                                Are you one of the researchers behind this study?
                              </FormLabel>
                              <div className="flex space-x-6">
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id="lead-author-yes"
                                    checked={field.value === true}
                                    onCheckedChange={() => field.onChange(true)}
                                  />
                                  <Label htmlFor="lead-author-yes" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                    Yes
                                  </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id="lead-author-no"
                                    checked={field.value === false}
                                    onCheckedChange={() => field.onChange(false)}
                                  />
                                  <Label htmlFor="lead-author-no" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                    No
                                  </Label>
                                </div>
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Contact Permission Question - only show if user is a researcher */}
                        {isLeadAuthor === true && (
                          <FormField
                            control={form.control}
                            name="canContactEmail"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-gray-700">
                                  May we contact you at the provided email address for any further inquiries?
                                </FormLabel>
                                <div className="flex space-x-6">
                                  <div className="flex items-center space-x-2">
                                    <Checkbox
                                      id="contact-paper-yes"
                                      checked={field.value === true}
                                      onCheckedChange={() => field.onChange(true)}
                                    />
                                    <Label htmlFor="contact-paper-yes" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                      Yes
                                    </Label>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <Checkbox
                                      id="contact-paper-no"
                                      checked={field.value === false}
                                      onCheckedChange={() => field.onChange(false)}
                                    />
                                    <Label htmlFor="contact-paper-no" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                      No
                                    </Label>
                                  </div>
                                </div>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}

                        {/* Would you like to help with curation? */}
                        <FormField
                          control={form.control}
                          name="wantsToHelpCurate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700">
                                Would you like to help prepare the data for cBioPortal?
                              </FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger className="shadow-sm border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                                    <SelectValue placeholder="Select an option" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent className="bg-white border border-gray-300">
                                  <SelectItem value="yes">Yes</SelectItem>
                                  <SelectItem value="no">No</SelectItem>
                                  <SelectItem value="maybe">Maybe</SelectItem>
                                </SelectContent>
                              </Select>
                              {(wantsToHelpCurate === "yes" || wantsToHelpCurate === "maybe") && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-3">
                                  <div className="flex items-start">
                                    <Info className="w-5 h-5 text-blue-600 mt-0.5 mr-2 flex-shrink-0" />
                                    <div className="text-sm text-blue-800">
                                      <p className="font-medium mb-1">Great! Here's how to get started:</p>
                                      <p>
                                        Review the{" "}
                                        <a 
                                          href="https://docs.cbioportal.org/file-formats/" 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="text-blue-700 hover:text-blue-900 underline font-medium inline-flex items-center"
                                        >
                                          cBioPortal File Format Guidelines
                                        </a>
                                        {" "}to understand the required data formats and structure.
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              )}
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    )}

                    {/* Data Submission Form Fields */}
                    {(actionType === "submit-data" || publicationType === "preprint") && (
                      <>
                        <FormField
                          control={form.control}
                          name="studyName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700">Study Name</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Dataset name"
                                  className="shadow-sm"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={form.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700">Study Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  rows={4}
                                  placeholder="Brief description of the study"
                                  className="shadow-sm resize-none"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {publicationType === "published" && (
                          <FormField
                            control={form.control}
                            name="associatedPaper"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-gray-700">Associated Paper</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="PMID or URL, if the paper is published"
                                    className="shadow-sm"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}

                        {/* Data Transformation Question */}
                        <FormField
                          control={form.control}
                          name="isDataTransformed"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700">
                                Is the data transformed according to cBioPortal file formats? <span className="text-red-500">*</span>{" "}
                                <a 
                                  href="https://docs.cbioportal.org/file-formats/" 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:text-blue-800 inline-flex items-center"
                                >
                                  View file formats
                                  <ExternalLink className="ml-1 h-3 w-3" />
                                </a>
                              </FormLabel>
                              <div className="flex space-x-6">
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id="transformed-yes"
                                    checked={field.value === true}
                                    onCheckedChange={() => field.onChange(true)}
                                  />
                                  <Label htmlFor="transformed-yes" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                    Yes
                                  </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id="transformed-no"
                                    checked={field.value === false}
                                    onCheckedChange={() => field.onChange(false)}
                                  />
                                  <Label htmlFor="transformed-no" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                    No
                                  </Label>
                                </div>
                              </div>
                              {isDataTransformed === false && (
                                <p className="text-sm text-red-600 mt-2">
                                  Please format your data according to cBioPortal file formats before submitting.
                                </p>
                              )}
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        {/* Data Types Available for Data Form */}
                        <div>
                          <div className="flex items-center mb-3">
                            <FormLabel className="text-gray-700">Available Data Types</FormLabel>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="w-4 h-4 text-gray-500 ml-2 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-sm">
                                    What data does the submission contain?
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 bg-gray-50 p-4 rounded-lg border border-gray-200">
                            {dataFormDataTypes.map((dataType) => (
                              <div key={dataType} className="flex items-start space-x-2">
                                <Checkbox
                                  id={`data-type-data-${dataType.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                                  checked={dataTypes?.includes(dataType) || false}
                                  onCheckedChange={(checked) => handleDataTypeChange(dataType, checked as boolean)}
                                  className="mt-1"
                                />
                                <Label htmlFor={`data-type-data-${dataType.toLowerCase().replace(/[^a-z0-9]/g, '-')}`} className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                  {dataType}
                                </Label>
                              </div>
                            ))}
                          </div>
                          {isOtherSelected && (
                            <div className="mt-4">
                              <FormField
                                control={form.control}
                                name="otherDataType"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input
                                        placeholder="Please specify other data type"
                                        className="shadow-sm"
                                        {...field}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                          )}
                        </div>

                        {/* Reference Genome Used */}
                        <FormField
                          control={form.control}
                          name="referenceGenome"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700">Reference Genome Used</FormLabel>
                              <FormControl>
                                <RadioGroup
                                  onValueChange={field.onChange}
                                  defaultValue={field.value}
                                  className="flex space-x-6"
                                >
                                  <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="GRCh37" id="grch37" />
                                    <Label htmlFor="grch37" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                      GRCh37
                                    </Label>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="GRCh38" id="grch38" />
                                    <Label htmlFor="grch38" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                      GRCh38
                                    </Label>
                                  </div>
                                </RadioGroup>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        {/* Data sharing via external link (required) */}
                        <DataSharingFields
                          key={`data-${actionType}-${publicationType}`}
                          control={form.control}
                          required={true}
                          linkLabel="Link to your data"
                        />

                        {/* Inline reminder if link or access confirmation is missing */}
                        {(!linkToData?.trim() || !accessGranted) && (actionType === "submit-data" || publicationType === "preprint") && (
                          <p className="text-xs text-amber-600 flex items-center gap-1">
                            <Info className="h-3 w-3" /> A data link and confirmation that you've granted access to {CURATION_EMAIL} are required.
                          </p>
                        )}

                        {/* Researcher question for data form */}
                        <FormField
                          control={form.control}
                          name="isLeadAuthor"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-700">
                                Are you one of the researchers behind this study?
                              </FormLabel>
                              <div className="flex space-x-6">
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id="lead-author-data-yes"
                                    checked={field.value === true}
                                    onCheckedChange={() => field.onChange(true)}
                                  />
                                  <Label htmlFor="lead-author-data-yes" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                    Yes
                                  </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id="lead-author-data-no"
                                    checked={field.value === false}
                                    onCheckedChange={() => field.onChange(false)}
                                  />
                                  <Label htmlFor="lead-author-data-no" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                    No
                                  </Label>
                                </div>
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Contact Permission Question - only show if user is a researcher */}
                        {isLeadAuthor === true && (
                          <div className="space-y-4">
                            <FormField
                              control={form.control}
                              name="canContactEmail"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-gray-700">
                                    May we contact you at the provided email address for any further inquiries?
                                  </FormLabel>
                                  <div className="flex space-x-6">
                                    <div className="flex items-center space-x-2">
                                      <Checkbox
                                        id="contact-data-yes"
                                        checked={field.value === true}
                                        onCheckedChange={() => field.onChange(true)}
                                      />
                                      <Label htmlFor="contact-data-yes" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                        Yes
                                      </Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      <Checkbox
                                        id="contact-data-no"
                                        checked={field.value === false}
                                        onCheckedChange={() => field.onChange(false)}
                                      />
                                      <Label htmlFor="contact-data-no" className="text-gray-600 cursor-pointer text-sm font-normal leading-tight">
                                        No
                                      </Label>
                                    </div>
                                  </div>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            {/* Alternative Email Question - only show if contact permission is No */}
                            {canContactEmail === false && (
                              <FormField
                                control={form.control}
                                name="alternativeEmail"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-gray-700">
                                      Is there an alternative email address to contact? <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                      <Input
                                        type="email"
                                        placeholder="Enter alternative email address"
                                        className="shadow-sm"
                                        required={canContactEmail === false}
                                        {...field}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {/* Comments field - Moved here under Question 3 */}
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-gray-700">Comments</FormLabel>
                          <FormControl>
                            <Textarea
                              rows={4}
                              placeholder="Any details or instructions that could help the curators review your submission."
                              className="shadow-sm resize-none"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Section 4: Contact Information */}
                  <div className="space-y-6">
                    <h2 className="text-lg font-semibold text-gray-800">4. Contact Information</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-gray-700">Name <span className="text-red-500">*</span></FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="Enter your name"
                                className="shadow-sm"
                                required
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-gray-700">
                              Email <span className="text-red-500">*</span>
                            </FormLabel>
                            <FormControl>
                            <Input
                                type="email"
                                placeholder="Enter your email"
                                className="shadow-sm"
                                required
                            {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="flex flex-col space-y-4 sm:flex-row sm:space-y-0 sm:space-x-4 sm:items-center sm:justify-between pt-6 border-t border-gray-200">
                    <div className="flex items-start">
                      <Info className="w-5 h-5 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
                      <p className="text-xs text-gray-600">
                        Fields marked with <span className="text-red-500">*</span> are required
                      </p>
                    </div>
                    
                    <Button 
                      type="submit" 
                      className="bg-blue-600 hover:bg-blue-700 text-white py-2.5 px-8 rounded-md transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed text-base font-medium"
                      disabled={isSubmitDisabled}
                    >
                      {isSubmitting ? "Submitting..." : actionType === "suggest-paper" ? "Submit Study Suggestion" : "Submit Data"}
                      {!isSubmitting && <ArrowRight className="ml-2 h-4 w-4" />}
                    </Button>
                  </div>
                  </>)}
                </form>
              </Form>
            </div>
          </div>
        </div>
      </div>

      {/* Success Modal */}
      <Dialog open={showSuccessModal} onOpenChange={() => doRedirect(redirectTab)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="text-center pb-2">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <DialogTitle className="text-2xl font-bold text-center">Thank You!</DialogTitle>
            <DialogDescription className="text-center text-base pt-1">
              {successMessage}
            </DialogDescription>
          </DialogHeader>

          {/* Pipeline steps */}
          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 text-center">What happens next</p>
            <div className="grid grid-cols-4 gap-2">
              {(submittedActionType === "suggest-paper" ? [
                { icon: <Search className="h-4 w-4" />, label: "Review", desc: "Team reviews paper for relevance", active: true },
                { icon: <CheckCircle className="h-4 w-4" />, label: "Data Check", desc: "Availability of usable data verified", active: false },
                { icon: <FlaskConical className="h-4 w-4" />, label: "Curation", desc: "Data extracted and formatted for cBioPortal", active: false },
                { icon: <Database className="h-4 w-4" />, label: "Published", desc: "Study goes live publicly", active: false },
              ] : [
                { icon: <Search className="h-4 w-4" />, label: "Review", desc: "Team reviews for completeness", active: true },
                { icon: <FlaskConical className="h-4 w-4" />, label: "Validation", desc: "Data checked against format requirements", active: false },
                { icon: <Database className="h-4 w-4" />, label: "Integration", desc: "Data loaded into cBioPortal", active: false },
                { icon: <CheckCircle className="h-4 w-4" />, label: "Published", desc: "Study goes live publicly", active: false },
              ]).map((step, i) => (
                <div key={i} className={`flex flex-col items-center text-center rounded-lg p-3 border ${
                  step.active
                    ? "bg-blue-50 border-blue-300"
                    : "bg-gray-50 border-gray-200"
                }`}>
                  <div className={`rounded-full p-2 mb-1.5 ${
                    step.active ? "bg-blue-100 text-blue-600" : "bg-gray-200 text-gray-400"
                  }`}>{step.icon}</div>
                  <p className={`text-xs font-semibold ${
                    step.active ? "text-blue-800" : "text-gray-400"
                  }`}>{i + 1}. {step.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-tight">{step.desc}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-center text-gray-400 mt-3 flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" /> Typical turnaround is 2–6 weeks.
            </p>
          </div>

          {/* Countdown bar */}
          <div className="mt-4">
            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${(countdown / 20) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-muted-foreground">
                Redirecting in {countdown}s...
              </p>
              <Button
                variant="outline"
                size="sm"
                className="text-blue-600 border-blue-300 hover:bg-blue-50 text-xs"
                onClick={() => doRedirect(redirectTab)}
              >
                Go to Tracker <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SharedLayout>
  );
};

export default SubmitContent;
