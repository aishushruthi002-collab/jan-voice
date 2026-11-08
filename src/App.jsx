
import { lazy, Suspense, useState, useEffect } from "react";
import { supabase } from "./supabase";
import Auth from "./Auth";
import "./App.css";

const LocationMap = lazy(() => import("./LocationMap"));
const COMPLAINTS_PAGE_SIZE = 1000;

export default function App() {
  const [page, setPage] = useState("Dashboard");
  const [user, setUser] = useState(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [roleState, setRoleState] = useState({ userId: null, isAuthority: false });
  const [complaints, setComplaints] = useState([]);
  const [complaintsLoadedFor, setComplaintsLoadedFor] = useState(null);
  const [search, setSearch] = useState("");
  const [authorityStatusFilter, setAuthorityStatusFilter] = useState("All statuses");
  const [authorityCategoryFilter, setAuthorityCategoryFilter] = useState("All categories");
  const [analyticsStartDate, setAnalyticsStartDate] = useState("");
  const [analyticsEndDate, setAnalyticsEndDate] = useState("");
  const [trackingId, setTrackingId] = useState("");
  const [selected, setSelected] = useState(null);
  const [selectedFor, setSelectedFor] = useState(null);
  const [officialResponseDraft, setOfficialResponseDraft] = useState({
    complaintId: null,
    text: "",
  });
  const [responseSavingFor, setResponseSavingFor] = useState(null);
  const [responseError, setResponseError] = useState("");
  const [formCoordinates, setFormCoordinates] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [photoFiles, setPhotoFiles] = useState([]);
  const [photoFormError, setPhotoFormError] = useState("");
  const [complaintPhotosState, setComplaintPhotosState] = useState({
    complaintCode: null,
    photos: [],
    loading: false,
    error: "",
  });
  const [form, setForm] = useState({
    title: "",
    category: "Roads",
    location: "",
    description: "",
  });
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusUpdatingFor, setStatusUpdatingFor] = useState(null);

  const isRoleLoading = Boolean(user && roleState.userId !== user.id);
  const isAuthority = Boolean(
    user && roleState.userId === user.id && roleState.isAuthority
  );

  async function handleLogout() {
    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        console.error("Logout failed:", error.message);
        setMessage("Logout failed. Please try again.");
        return;
      }

      setUser(null);
      setMessage("");
    } catch (error) {
      console.error("Logout failed:", error);
      setMessage("Logout failed. Please try again.");
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
      } else if (event === "SIGNED_OUT") {
        setIsPasswordRecovery(false);
      }
      setRoleState({ userId: null, isAuthority: false });
      setComplaintsLoadedFor(null);
      setSelected(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let isActive = true;

    if (!user) return () => {
      isActive = false;
    };

    async function loadUserData() {
      try {
        const roleResult = await supabase.rpc("is_authority");

        if (!isActive) return;

        const roleError = roleResult.error;
        const verifiedAuthority = !roleError && roleResult.data === true;

        setRoleState({
          userId: user.id,
          isAuthority: verifiedAuthority,
        });

        const allComplaintRows = [];
        let complaintsError = null;
        let offset = 0;
        let pageRows = [];

        do {
          let complaintsQuery = supabase
            .from("complaints")
            .select("*")
            .order("created_at", { ascending: false })
            .range(offset, offset + COMPLAINTS_PAGE_SIZE - 1);

          if (!verifiedAuthority) {
            complaintsQuery = complaintsQuery.eq("user_id", user.id);
          }

          const result = await complaintsQuery;
          complaintsError = result.error;
          pageRows = result.data || [];
          allComplaintRows.push(...pageRows);
          offset += COMPLAINTS_PAGE_SIZE;
        } while (!complaintsError && pageRows.length === COMPLAINTS_PAGE_SIZE);

        if (!isActive) return;

        if (complaintsError) {
          console.error("Error loading complaints:", complaintsError.message);
          setComplaints([]);
          setMessage("Could not load complaints. Please check the database connection.");
        } else {
          const formattedComplaints = allComplaintRows.map((item) => ({
            id: item.complaint_code,
            userId: item.user_id,
            title: item.title,
            category: item.category,
            location: item.location,
            description: item.description,
            status: item.status,
            date: item.created_at.slice(0, 10),
            createdAt: item.created_at,
            officialResponseSupported: Object.hasOwn(item, "authority_response"),
            officialResponse: item.authority_response ?? "",
            officialResponseAt: item.authority_response_at ?? null,
            latitude: item.latitude,
            longitude: item.longitude,
          }));

          setComplaints(formattedComplaints);
          setComplaintsLoadedFor(user.id);
        }

        if (roleError) {
          console.error("Error loading user role:", roleError.message);
          setMessage("Could not verify authority access. Authority features are unavailable.");
        } else if (!complaintsError) {
          setMessage("");
        }
      } catch (error) {
        if (!isActive) return;
        console.error("Could not load user access and complaints:", error);
        setRoleState({ userId: user.id, isAuthority: false });
        setComplaints([]);
        setComplaintsLoadedFor(user.id);
        setMessage("Could not load your account access. Please try again.");
      }
    }

    loadUserData();

    return () => {
      isActive = false;
    };
  }, [user]);

  function openReport() {
    setMessage("");
    setPhotoFormError("");
    setLocationError("");
    setFormCoordinates(null);
    setPage("Report an Issue");
  }

  function useCurrentLocation() {
    setLocationError("");

    if (!navigator.geolocation) {
      setLocationError("Location is unavailable in this browser. Select a point on the map instead.");
      return;
    }

    setIsLocating(true);

    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          setFormCoordinates({
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
          setLocationError("");
          setIsLocating(false);
        },
        (error) => {
          const errorMessage = {
            1: "Location permission was denied. Allow location access or select a point on the map.",
            2: "Your position could not be determined. Try again or select a point on the map.",
            3: "Location detection timed out. Try again or select a point on the map.",
          }[error.code] || "Could not detect your location. Select a point on the map instead.";

          setLocationError(errorMessage);
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    } catch (error) {
      console.error("Could not request the current location:", error);
      setLocationError("Could not request your location. Check browser permissions or select a point on the map.");
      setIsLocating(false);
    }
  }

  function selectComplaint(complaint) {
    setSelected(complaint);
    setSelectedFor(user.id);
    setOfficialResponseDraft({
      complaintId: complaint.id,
      text: complaint.officialResponse || "",
    });
    setResponseError("");
    setPage("Complaint Details");
  }

  async function submitComplaint(e) {
    e.preventDefault();

    if (isSubmitting) return;
    setPhotoFormError("");

    if (photoFiles.length > 0 && !globalThis.crypto?.randomUUID) {
      setPhotoFormError("Secure photo filenames are unavailable in this browser. Try a supported browser or submit without photos.");
      return;
    }

    if (
      !formCoordinates ||
      !Number.isFinite(formCoordinates.latitude) ||
      !Number.isFinite(formCoordinates.longitude) ||
      formCoordinates.latitude < -90 ||
      formCoordinates.latitude > 90 ||
      formCoordinates.longitude < -180 ||
      formCoordinates.longitude > 180
    ) {
      setMessage("Detect your location or select a point on the map before submitting.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      const { data, error } = await supabase
        .from("complaints")
        .insert([
          {
            title: form.title.trim(),
            category: form.category,
            location: form.location.trim(),
            description: form.description.trim(),
            latitude: formCoordinates.latitude,
            longitude: formCoordinates.longitude,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Complaint submission failed:", error.message);
        setPhotoFormError("Submission failed: " + error.message);
        return;
      }

      const complaintCode = data.complaint_code;
      const uploadedPaths = [];

      if (photoFiles.length > 0) {
        const bucket = supabase.storage.from("complaint-photos");
        let failedUpload = null;

        for (const { file } of photoFiles) {
          const extension = file.name.split(".").pop().toLowerCase();
          const mimeType = extension === "png"
            ? "image/png"
            : extension === "webp"
              ? "image/webp"
              : "image/jpeg";
          const path = `${user.id}/${complaintCode}/${globalThis.crypto.randomUUID()}.${extension}`;
          uploadedPaths.push(path);

          try {
            const { error: uploadError } = await bucket.upload(path, file, {
              contentType: mimeType,
              upsert: false,
            });

            if (uploadError) failedUpload = uploadError;
          } catch (uploadError) {
            failedUpload = uploadError;
          }

          if (failedUpload) {
            break;
          }
        }

        if (failedUpload) {
          console.error("Complaint photo upload failed:", failedUpload.message);
          let cleanupError = null;

          if (uploadedPaths.length > 0) {
            try {
              const { error: removeError } = await bucket.remove(uploadedPaths);
              cleanupError = removeError;
              if (removeError) {
                console.error("Could not clean up uploaded complaint photos:", removeError.message);
              }
            } catch (removeError) {
              cleanupError = removeError;
              console.error("Could not clean up uploaded complaint photos:", removeError);
            }
          }

          let deletedRows = null;
          let deleteError = null;
          if (!cleanupError) {
            try {
              const deleteResult = await supabase
                .from("complaints")
                .delete()
                .eq("complaint_code", complaintCode)
                .eq("user_id", user.id)
                .select("complaint_code");
              deletedRows = deleteResult.data;
              deleteError = deleteResult.error;
            } catch (rollbackError) {
              deleteError = rollbackError;
            }
          }

          const complaintRemoved = !deleteError && deletedRows?.length === 1;
          if (deleteError) {
            console.error("Could not roll back complaint after photo upload failure:", deleteError.message);
          } else if (!complaintRemoved && !cleanupError) {
            console.error("Complaint rollback returned no deleted row; the active RLS policy may prevent citizen deletes.");
          }

          if (!complaintRemoved) {
            setComplaints((previous) => [
              {
                id: complaintCode,
                userId: user.id,
                title: data.title,
                category: data.category,
                location: data.location,
                description: data.description,
                status: data.status,
                date: data.created_at.slice(0, 10),
                createdAt: data.created_at,
                latitude: data.latitude,
                longitude: data.longitude,
              },
              ...(complaintsLoadedFor === user.id ? previous : []),
            ]);
            setComplaintsLoadedFor(user.id);
          }

          const details = [
            `Photo upload failed for complaint ${complaintCode}.`,
            complaintRemoved
              ? "The complaint was rolled back."
              : cleanupError
                ? `The complaint record remains (code ${complaintCode}) because an uploaded object could not be safely removed.`
                : `The complaint record remains without its photos (code ${complaintCode}).`,
            cleanupError ? `Storage cleanup failed: ${cleanupError.message || "unknown error"}.` : "",
            !complaintRemoved && !cleanupError
              ? "The current complaint-table permissions or RLS policies did not allow rollback; the record remains visible without photos."
              : "",
          ].filter(Boolean).join(" ");
          setPhotoFormError(`${details} ${failedUpload.message}`);
          return;
        }
      }

      const newComplaint = {
        id: complaintCode,
        userId: data.user_id || user.id,
        title: data.title,
        category: data.category,
        location: data.location,
        description: data.description,
        status: data.status,
        date: data.created_at.slice(0, 10),
        createdAt: data.created_at,
        officialResponseSupported: Object.hasOwn(data, "authority_response"),
        officialResponse: data.authority_response ?? "",
        officialResponseAt: data.authority_response_at ?? null,
        latitude: data.latitude,
        longitude: data.longitude,
      };

      setComplaints((previous) => [
        newComplaint,
        ...(complaintsLoadedFor === user.id ? previous : []),
      ]);
      setComplaintsLoadedFor(user.id);

      setForm({
        title: "",
        category: "Roads",
        location: "",
        description: "",
      });
      setFormCoordinates(null);
      setLocationError("");
      setPhotoFiles([]);
      setPhotoFormError("");

      setMessage("Your complaint has been submitted successfully!");
      setPage("My Complaints");
    } catch (error) {
      console.error("Complaint submission failed:", error);
      setPhotoFormError("Submission could not be completed. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePhotoSelection(event) {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";

    if (selectedFiles.length === 0) return;
    if (photoFiles.length + selectedFiles.length > 3) {
      setPhotoFormError("Choose no more than 3 photos per complaint.");
      return;
    }

    const acceptedMimeTypes = {
      jpg: ["image/jpeg", "image/jpg", "image/pjpeg"],
      jpeg: ["image/jpeg", "image/jpg", "image/pjpeg"],
      png: ["image/png"],
      webp: ["image/webp"],
    };
    const invalidFile = selectedFiles.find((file) => {
      const extension = file.name.split(".").pop().toLowerCase();
      return (
        !acceptedMimeTypes[extension] ||
        (file.type && !acceptedMimeTypes[extension]?.includes(file.type)) ||
        file.size > 5 * 1024 * 1024
      );
    });

    if (invalidFile) {
      const extension = invalidFile.name.split(".").pop().toLowerCase();
      setPhotoFormError(
        invalidFile.size > 5 * 1024 * 1024
          ? `${invalidFile.name} exceeds the 5 MB per-photo limit.`
          : !acceptedMimeTypes[extension] ||
              (invalidFile.type && !acceptedMimeTypes[extension]?.includes(invalidFile.type))
            ? `${invalidFile.name} is not a supported JPG, JPEG, PNG or WEBP image.`
            : "One or more selected photos are invalid."
      );
      return;
    }

    setPhotoFormError("");
    const newlySelected = [...photoFiles.map((photo) => photo.file), ...selectedFiles];
    setPhotoFiles(newlySelected.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    })));
  }

  function removePhoto(index) {
    setPhotoFiles(photoFiles
      .filter((_, photoIndex) => photoIndex !== index)
      .map(({ file }) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      })));
    setPhotoFormError("");
  }

  async function updateStatus(id, status) {
    if (!isAuthority) {
      setMessage("You are not authorized to update complaint statuses.");
      return;
    }

    setMessage("");
    setStatusUpdatingFor(id);

    try {
      const { data, error } = await supabase
        .from("complaints")
        .update({ status })
        .eq("complaint_code", id)
        .select("complaint_code, status")
        .maybeSingle();

      if (error) {
        console.error("Status update failed:", error.message);
        setMessage("Could not update status. Please try again.");
        return;
      }

      if (!data) {
        setMessage("No complaint was updated. Please refresh and try again.");
        return;
      }

      setComplaints((previous) =>
        previous.map((complaint) =>
          complaint.id === id ? { ...complaint, status: data.status } : complaint
        )
      );
      setSelected((old) =>
        old && old.id === id ? { ...old, status: data.status } : old
      );
      setMessage("Complaint status updated successfully!");
    } catch (error) {
      console.error("Status update failed:", error);
      setMessage("Could not update status. Please try again.");
    } finally {
      setStatusUpdatingFor(null);
    }
  }

  async function saveOfficialResponse(complaint) {
    if (!isAuthority || isRoleLoading) {
      setResponseError("Verified authority access is required to publish an official response.");
      return;
    }

    if (!complaint.officialResponseSupported) {
      setResponseError("Official responses are unavailable until the database migration is applied.");
      return;
    }

    const responseText = officialResponseDraft.complaintId === complaint.id
      ? officialResponseDraft.text.trim()
      : complaint.officialResponse || "";
    setResponseError("");
    setResponseSavingFor(complaint.id);

    try {
      const { data, error } = await supabase
        .from("complaints")
        .update({ authority_response: responseText || null })
        .eq("complaint_code", complaint.id)
        .select("complaint_code, authority_response, authority_response_at")
        .maybeSingle();

      if (error) {
        console.error("Could not save official response:", error.message);
        setResponseError("Could not save the official response. Check that the response migration is applied and try again.");
        return;
      }

      if (!data) {
        setResponseError("No complaint was updated. Refresh the complaint and try again.");
        return;
      }

      const updatedResponse = {
        officialResponseSupported: true,
        officialResponse: data.authority_response ?? "",
        officialResponseAt: data.authority_response_at ?? null,
      };
      setComplaints((previous) =>
        previous.map((item) =>
          item.id === complaint.id ? { ...item, ...updatedResponse } : item
        )
      );
      setSelected((previous) =>
        previous?.id === complaint.id
          ? { ...previous, ...updatedResponse }
          : previous
      );
      setOfficialResponseDraft({
        complaintId: complaint.id,
        text: data.authority_response ?? "",
      });
      setMessage("Official response saved successfully.");
    } catch (error) {
      console.error("Could not save official response:", error);
      setResponseError("Could not save the official response. Please try again.");
    } finally {
      setResponseSavingFor(null);
    }
  }

  async function trackComplaintById(complaintId) {
    const { data, error } = await supabase
      .from("complaints")
      .select("*")
      .eq("complaint_code", complaintId.trim())
      .maybeSingle();

    if (error) {
      console.error("Tracking error:", error.message);
      setMessage("Unable to search for this complaint.");
      return;
    }

    if (!data) {
      setMessage("No complaint found with that ID.");
      setSelected(null);
      return;
    }

    setSelected({
      id: data.complaint_code,
      userId: data.user_id,
      title: data.title,
      category: data.category,
      location: data.location,
      description: data.description,
      status: data.status,
      date: data.created_at.slice(0, 10),
      createdAt: data.created_at,
      officialResponseSupported: Object.hasOwn(data, "authority_response"),
      officialResponse: data.authority_response ?? "",
      officialResponseAt: data.authority_response_at ?? null,
      latitude: data.latitude,
      longitude: data.longitude,
    });
    setSelectedFor(user.id);
    setOfficialResponseDraft({
      complaintId: data.complaint_code,
      text: data.authority_response ?? "",
    });
    setResponseError("");
    setPage("Complaint Details");

    setMessage("");
  }

  const visibleComplaints =
    user && complaintsLoadedFor === user.id ? complaints : [];
  const visibleSelected =
    user && selectedFor === user.id ? selected : null;

  const activePage =
    page === "Authority Panel" && (!isAuthority || isRoleLoading)
      ? "Dashboard"
      : page === "Complaint Details" && !visibleSelected
        ? "Dashboard"
      : page;

  const filtered = visibleComplaints.filter((c) =>
    `${c.id} ${c.title} ${c.category} ${c.location}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const authorityCategories = [...new Set(visibleComplaints.map((c) => c.category))]
    .sort((first, second) => first.localeCompare(second));
  const authorityFiltered = visibleComplaints.filter((complaint) => {
    const matchesSearch = `${complaint.id} ${complaint.title} ${complaint.category} ${complaint.location}`
      .toLowerCase()
      .includes(search.trim().toLowerCase());
    const matchesStatus =
      authorityStatusFilter === "All statuses" || complaint.status === authorityStatusFilter;
    const matchesCategory =
      authorityCategoryFilter === "All categories" ||
      complaint.category === authorityCategoryFilter;

    return matchesSearch && matchesStatus && matchesCategory;
  });
  const authorityMapComplaints = isAuthority
    ? visibleComplaints.filter(
      (complaint) =>
        Number.isFinite(complaint.latitude) &&
        Number.isFinite(complaint.longitude) &&
        complaint.latitude >= -90 &&
        complaint.latitude <= 90 &&
        complaint.longitude >= -180 &&
        complaint.longitude <= 180
    )
    : [];

  const totalComplaints = visibleComplaints.length;
  const pendingCount = visibleComplaints.filter((c) => c.status === "Pending").length;
  const inProgressCount = visibleComplaints.filter((c) => c.status === "In Progress").length;
  const resolvedCount = visibleComplaints.filter((c) => c.status === "Resolved").length;
  const complaintsReady = complaintsLoadedFor === user?.id;
  const analyticsRangeInvalid = Boolean(
    analyticsStartDate && analyticsEndDate && analyticsStartDate > analyticsEndDate
  );
  const analyticsComplaints =
    isAuthority && complaintsReady && !analyticsRangeInvalid
      ? visibleComplaints.filter((complaint) => {
        const createdAt = Date.parse(complaint.createdAt);
        if (!Number.isFinite(createdAt)) return false;
        const createdDate = new Date(createdAt).toISOString().slice(0, 10);
        return (
          (!analyticsStartDate || createdDate >= analyticsStartDate) &&
          (!analyticsEndDate || createdDate <= analyticsEndDate)
        );
      })
      : [];
  const analyticsPendingCount = analyticsComplaints.filter(
    (complaint) => complaint.status === "Pending"
  ).length;
  const analyticsInProgressCount = analyticsComplaints.filter(
    (complaint) => complaint.status === "In Progress"
  ).length;
  const analyticsResolvedCount = analyticsComplaints.filter(
    (complaint) => complaint.status === "Resolved"
  ).length;
  const categoryCounts = Object.entries(
    analyticsComplaints.reduce((counts, complaint) => {
      const category = complaint.category?.trim() || "Uncategorized";
      counts[category] = (counts[category] || 0) + 1;
      return counts;
    }, {})
  ).sort(([firstCategory, firstCount], [secondCategory, secondCount]) =>
    secondCount - firstCount || firstCategory.localeCompare(secondCategory)
  );
  const topCategories = categoryCounts.slice(0, 5);
  const complaintTrend = buildComplaintTrend(
    analyticsComplaints,
    analyticsStartDate,
    analyticsEndDate
  );
  const metadataName = user?.user_metadata?.full_name;
  const welcomeName =
    (typeof metadataName === "string" && metadataName.trim()) ||
    user?.email?.split("@")[0] ||
    "there";

  const navItems = [
    { name: "Dashboard", page: "Dashboard", icon: "⌂" },
    { name: "Report an Issue", page: "Report an Issue", icon: "+" },
    { name: "My Complaints", page: "My Complaints", icon: "▤" },
    { name: "Track Complaint", page: "track", icon: "⌕" },
    { name: "Authority Panel", page: "Authority Panel", icon: "▣" },
  ].filter((item) =>
    item.page !== "Authority Panel" || (isAuthority && !isRoleLoading)
  );

  const pageTitle = activePage === "track" ? "Track Complaint" : activePage;
  const currentPhotosState = complaintPhotosState.complaintCode === visibleSelected?.id
    ? complaintPhotosState
    : {
      complaintCode: visibleSelected?.id,
      photos: [],
      loading: activePage === "Complaint Details",
      error: "",
    };

  useEffect(() => () => {
    photoFiles.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
  }, [photoFiles]);

  useEffect(() => {
    const complaintCode = visibleSelected?.id;
    const ownerId = visibleSelected?.userId;

    if (activePage !== "Complaint Details" || !complaintCode || !ownerId) {
      return undefined;
    }

    let isActive = true;

    async function loadComplaintPhotos() {
      const bucket = supabase.storage.from("complaint-photos");
      const prefix = `${ownerId}/${complaintCode}`;
      const createdPhotoUrls = [];
      setComplaintPhotosState({
        complaintCode,
        photos: [],
        loading: true,
        error: "",
      });

      try {
        const { data: objects, error: listError } = await bucket.list(prefix, {
          limit: 4,
          sortBy: { column: "name", order: "asc" },
        });

        if (listError) throw listError;

        const validObjects = (objects || []).filter((object) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i
            .test(object.name)
        );

        if (validObjects.length > 3) {
          throw new Error("This complaint has more than 3 stored photos. Please contact support.");
        }

        const downloads = [];
        for (const object of validObjects) {
          const path = `${prefix}/${object.name}`;
          const { data: blob, error: downloadError } = await bucket.download(path);
          if (downloadError) throw downloadError;
          const url = URL.createObjectURL(blob);
          createdPhotoUrls.push(url);
          downloads.push({
            name: object.name,
            url,
          });
        }

        if (!isActive) {
          createdPhotoUrls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }

        setComplaintPhotosState({
          complaintCode,
          photos: downloads,
          loading: false,
          error: "",
        });
      } catch (error) {
        createdPhotoUrls.forEach((url) => URL.revokeObjectURL(url));
        if (!isActive) return;
        console.error("Could not load complaint photos:", error);
        setComplaintPhotosState({
          complaintCode,
          photos: [],
          loading: false,
          error: "Complaint photos could not be loaded. Check your access or try again.",
        });
      } finally {
        if (isActive) {
          setComplaintPhotosState((previous) =>
            previous.complaintCode === complaintCode
              ? { ...previous, loading: false }
              : previous
          );
        }
      }
    }

    loadComplaintPhotos();
    return () => {
      isActive = false;
    };
  }, [activePage, visibleSelected?.id, visibleSelected?.userId]);

  useEffect(() => () => {
    complaintPhotosState.photos.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [complaintPhotosState.photos]);

  if (!user || isPasswordRecovery) {
    return (
      <Auth
        key={isPasswordRecovery ? "password-reset" : "auth"}
        resetMode={isPasswordRecovery}
        onPasswordUpdated={() => {
          setIsPasswordRecovery(false);
          setMessage("Your password has been updated.");
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage("Dashboard")}>
          <span className="brand-icon">J</span>
          <span>
            <strong>JanVoice</strong>
            <small>Your city. Your voice.</small>
          </span>
        </button>

        <p className="menu-label">MAIN MENU</p>

        <nav>
          {navItems.map((item) => (
            <button
              key={item.name}
              className={`nav-item ${activePage === item.page ? "active" : ""}`}
              onClick={() => {
                setPage(item.page);
                setMessage("");
                setSelected(null);
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.name}
              {item.name === "Report an Issue" && <span className="nav-plus">+</span>}
            </button>
          ))}
        </nav>

        <button className="sidebar-logout" onClick={handleLogout}>
          Logout
        </button>

        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-icon">♡</span>
            <strong>Better cities start with us.</strong>
            <p>Your voice can make a difference in your community.</p>
            <button onClick={openReport}>Report a problem →</button>
          </div>
          <p className="sidebar-footer">JANVOICE © 2026</p>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="breadcrumb">Community / {pageTitle}</p>
            <h2>{pageTitle}</h2>
          </div>
          <div className="topbar-right">
            <span className="online-dot" />
            <span className="citizen-label">{isAuthority ? "Authority Portal" : "Citizen Portal"}</span>
            <div className="avatar">{isAuthority ? "A" : "C"}</div>
          </div>
        </header>

        <div className="page-content">
          {message && <div className="success-message">✓ {message}</div>}

          {activePage === "Dashboard" && (
            <>
              <section className="welcome-banner">
                <div className="welcome-text">
                  <span className="eyebrow">CITIZEN ENGAGEMENT PORTAL</span>
                  <h1>Welcome back,<br />{welcomeName}.</h1>
                  <p>Your reports help make your community a better place. See an issue? Let us know.</p>
                  <button className="primary-btn" onClick={openReport}>
                    + Report an Issue <span>→</span>
                  </button>
                </div>
                <div className="welcome-art" aria-hidden="true">
                  <div className="sun" />
                  <div className="art-building building-one"><span>▥</span></div>
                  <div className="art-building building-two"><span>▥</span></div>
                  <div className="art-building building-three"><span>▥</span></div>
                  <div className="art-tree">♣</div>
                  <div className="art-ground" />
                </div>
                <div className="banner-decoration">✳</div>
              </section>

              <div className="section-heading">
                <div>
                  <h3>{isAuthority ? "Community overview" : "Your complaint overview"}</h3>
                  <p>
                    {isAuthority
                      ? "Here's what's happening with civic issues."
                      : "A quick look at the issues you've reported."}
                  </p>
                </div>
                <span className="live-tag"><span /> LIVE OVERVIEW</span>
              </div>

              <section className="stats-grid dashboard-stats">
                <div className="stat-card">
                  <div className="stat-top"><span>{isAuthority ? "Total complaints" : "Your complaints"}</span><span className="stat-icon green">▤</span></div>
                  <h2>{complaintsReady ? totalComplaints : "—"}</h2>
                  <p className="stat-note">{isAuthority ? "All reported issues" : "Your reported issues"}</p>
                </div>
                <div className="stat-card">
                  <div className="stat-top"><span>Pending</span><span className="stat-icon orange">◷</span></div>
                  <h2>{complaintsReady ? pendingCount : "—"}</h2>
                  <p className="stat-note">Awaiting attention</p>
                </div>
                <div className="stat-card">
                  <div className="stat-top"><span>In progress</span><span className="stat-icon blue">↻</span></div>
                  <h2>{complaintsReady ? inProgressCount : "—"}</h2>
                  <p className="stat-note">Being addressed</p>
                </div>
                <div className="stat-card">
                  <div className="stat-top"><span>Resolved</span><span className="stat-icon green">✓</span></div>
                  <h2>{complaintsReady ? resolvedCount : "—"}</h2>
                  <p className="stat-note">Successfully resolved</p>
                </div>
              </section>

              <section className="content-card dashboard-recent">
                <div className="card-heading">
                  <div>
                    <h3>{isAuthority ? "Recent complaints" : "Your recent complaints"}</h3>
                    <p>{isAuthority ? "The latest reports from your community." : "The latest updates on the issues you've reported."}</p>
                  </div>
                  <button className="text-btn" onClick={() => setPage("My Complaints")}>View all →</button>
                </div>
                <ComplaintTable
                  complaints={visibleComplaints.slice(0, 4)}
                  onSelect={selectComplaint}
                  emptyMessage={complaintsReady ? undefined : "Loading your complaints..."}
                />
              </section>

              <div className="bottom-note">
                <span>♧</span>
                <p><strong>Every report matters.</strong> Together, we can build cleaner, safer and better-connected communities.</p>
                <button onClick={openReport}>Get involved →</button>
              </div>
            </>
          )}

          {activePage === "Report an Issue" && (
            <section className="content-card form-card">
              <div className="form-intro">
                <div className="form-icon">＋</div>
                <div><h3>Report a civic issue</h3><p>Provide the details below so the appropriate team can review your complaint.</p></div>
              </div>
              {photoFormError && <p className="photo-error" role="alert">{photoFormError}</p>}

              <form onSubmit={submitComplaint}>
                <label>Issue title <span>*</span>
                  <input required maxLength={100} placeholder="e.g. Garbage overflowing near my street" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>

                <div className="form-row">
                  <label>Issue category <span>*</span>
                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                      <option>Roads</option>
                      <option>Garbage</option>
                      <option>Water Supply</option>
                      <option>Electricity</option>
                      <option>Drainage</option>
                      <option>Public Safety</option>
                      <option>Other</option>
                    </select>
                  </label>
                  <label>Location <span>*</span>
                    <input required placeholder="Street, area or landmark" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                  </label>
                </div>

                <section className="location-picker" aria-labelledby="location-picker-title">
                  <div className="location-picker-heading">
                    <div>
                      <h3 id="location-picker-title">Pin the issue location</h3>
                      <p>Use GPS or click the map and drag the marker to the exact spot.</p>
                    </div>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={useCurrentLocation}
                      disabled={isLocating}
                    >
                      {isLocating ? "Detecting location..." : "Use My Current Location"}
                    </button>
                  </div>
                  {locationError && <p className="location-error" role="alert">{locationError}</p>}
                  {formCoordinates && (
                    <p className="location-coordinates" role="status">
                      Selected coordinates: {formCoordinates.latitude.toFixed(6)}, {formCoordinates.longitude.toFixed(6)}
                    </p>
                  )}
                  <Suspense fallback={<div className="location-map location-picker-map location-map-loading">Loading map...</div>}>
                    <LocationMap
                      selection={formCoordinates}
                      onSelect={(coordinates) => {
                        setFormCoordinates(coordinates);
                        setLocationError("");
                      }}
                      selectable
                      className="location-picker-map"
                    />
                  </Suspense>
                </section>

                <label>Description <span>*</span>
                  <textarea required rows="5" maxLength={1000} placeholder="Explain the issue and how it affects the community..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </label>

                {!isAuthority && (
                  <section className="photo-upload-section" aria-labelledby="photo-upload-title">
                    <div className="photo-upload-heading">
                      <div>
                        <h3 id="photo-upload-title">Add photos</h3>
                        <p>Up to 3 JPG, PNG or WEBP images, 5 MB maximum each.</p>
                      </div>
                      <label className="secondary-btn photo-select-btn">
                        {photoFiles.length === 0 ? "Choose photos" : "Add more"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                          multiple
                          disabled={isSubmitting || photoFiles.length >= 3}
                          onChange={handlePhotoSelection}
                          aria-label="Choose up to 3 complaint photos"
                        />
                      </label>
                    </div>
                    {photoFiles.length > 0 && (
                      <div className="photo-preview-grid">
                        {photoFiles.map(({ file, previewUrl }, index) => (
                          <div className="photo-preview" key={`${file.name}-${index}`}>
                            <img src={previewUrl} alt={`Selected complaint photo ${index + 1}`} />
                            <span title={file.name}>{file.name}</span>
                            <button
                              type="button"
                              className="photo-remove-btn"
                              onClick={() => removePhoto(index)}
                              disabled={isSubmitting}
                              aria-label={`Remove ${file.name}`}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                <div className="form-hint">Please provide accurate details to help with resolution.</div>
                <div className="form-actions">
                  <button type="button" className="secondary-btn" onClick={() => setPage("Dashboard")}>Cancel</button>
                  <button
                    type="submit"
                    className="primary-btn"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Submitting..." : "Submit complaint →"}
                  </button>
                </div>
              </form>
            </section>
          )}

          {activePage === "My Complaints" && (
            <section className="content-card">
              <div className="card-heading">
                <div><h3>My complaints</h3><p>Search and track issues submitted by your account.</p></div>
                <button className="primary-btn small-btn" onClick={openReport}>+ New complaint</button>
              </div>
              <SearchBox search={search} setSearch={setSearch} onTrack={() => trackComplaintById(search)} />
              <ComplaintTable complaints={filtered} onSelect={selectComplaint} />
            </section>
          )}

          {activePage === "track" && (
            <section className="content-card form-card">
              <div className="card-heading">
                <div><h3>Track a complaint</h3><p>Search complaints to check their latest status and details.</p></div>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                trackComplaintById(trackingId);
              }}>
                <label htmlFor="tracking-id">Complaint ID
                  <input
                    id="tracking-id"
                    required
                    placeholder="Enter your complaint ID"
                    value={trackingId}
                    onChange={(e) => setTrackingId(e.target.value)}
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary-btn">Track complaint →</button>
                </div>
              </form>
              <SearchBox search={search} setSearch={setSearch} onTrack={() => trackComplaintById(search)} />
              <ComplaintTable complaints={filtered} onSelect={selectComplaint} />
              {filtered.length === 0 && <p className="empty-state">No complaints found. Try a different search.</p>}
            </section>
          )}

          {activePage === "Authority Panel" && isAuthority && !isRoleLoading && (
            <section className="authority-dashboard">
              <div className="section-heading authority-heading">
                <div>
                  <h3>Authority Analytics</h3>
                  <p>Review verified complaint data and recent reporting patterns.</p>
                </div>
                <span className="demo-tag">VERIFIED AUTHORITY</span>
              </div>

              <section className="content-card analytics-filters" aria-label="Analytics date range">
                <div>
                  <h3>Analytics date range</h3>
                  <p>Counts and charts use complaint submission dates (UTC).</p>
                </div>
                <div className="analytics-date-fields">
                  <label>
                    <span>From</span>
                    <input
                      type="date"
                      value={analyticsStartDate}
                      max={analyticsEndDate || undefined}
                      onChange={(event) => setAnalyticsStartDate(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      type="date"
                      value={analyticsEndDate}
                      min={analyticsStartDate || undefined}
                      onChange={(event) => setAnalyticsEndDate(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="text-btn analytics-clear-btn"
                    onClick={() => {
                      setAnalyticsStartDate("");
                      setAnalyticsEndDate("");
                    }}
                    disabled={!analyticsStartDate && !analyticsEndDate}
                  >
                    Clear dates
                  </button>
                </div>
                {analyticsRangeInvalid && (
                  <p className="analytics-range-error" role="alert">
                    The start date must be on or before the end date.
                  </p>
                )}
              </section>

              <section className="stats-grid authority-stats" aria-label="Complaint counts">
                <AuthorityStat label="Total complaints" value={complaintsReady && !analyticsRangeInvalid ? analyticsComplaints.length : "—"} icon="▤" tone="green" note="In selected date range" />
                <AuthorityStat label="Pending" value={complaintsReady && !analyticsRangeInvalid ? analyticsPendingCount : "—"} icon="◷" tone="orange" note="In selected date range" />
                <AuthorityStat label="In Progress" value={complaintsReady && !analyticsRangeInvalid ? analyticsInProgressCount : "—"} icon="↻" tone="blue" note="In selected date range" />
                <AuthorityStat label="Resolved" value={complaintsReady && !analyticsRangeInvalid ? analyticsResolvedCount : "—"} icon="✓" tone="green" note="In selected date range" />
              </section>

              <section className="analytics-grid" aria-label="Complaint analytics charts">
                <article className="content-card analytics-card">
                  <div className="card-heading">
                    <div>
                      <h3>Complaints by category</h3>
                      <p>Distribution for the selected date range.</p>
                    </div>
                  </div>
                  {categoryCounts.length > 0 ? (
                    <div className="category-chart">
                      {categoryCounts.map(([category, count]) => (
                        <div className="category-chart-row" key={category}>
                          <span className="category-chart-label" title={category}>{category}</span>
                          <div
                            className="category-chart-track"
                            role="img"
                            aria-label={`${category}: ${count} complaints`}
                          >
                            <span
                              className="category-chart-bar"
                              style={{ width: `${(count / categoryCounts[0][1]) * 100}%` }}
                            />
                          </div>
                          <strong>{count}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="analytics-empty">
                      {complaintsReady && !analyticsRangeInvalid
                        ? "No complaints were submitted in this date range."
                        : "Complaint data is unavailable for analytics."}
                    </p>
                  )}
                </article>

                <article className="content-card analytics-card">
                  <div className="card-heading">
                    <div>
                      <h3>Complaint trend</h3>
                      <p>{complaintTrend.interval === "day" ? "Daily submissions" : "Monthly submissions"} based on created_at.</p>
                    </div>
                  </div>
                  {complaintTrend.points.length > 0 ? (
                    <ComplaintTrendChart trend={complaintTrend} />
                  ) : (
                    <p className="analytics-empty">
                      {complaintsReady && !analyticsRangeInvalid
                        ? "No complaint activity is available for this date range."
                        : "Complaint data is unavailable for analytics."}
                    </p>
                  )}
                </article>

                <article className="content-card analytics-card analytics-top-categories">
                  <div className="card-heading">
                    <div>
                      <h3>Most reported categories</h3>
                      <p>Top categories in the selected date range.</p>
                    </div>
                  </div>
                  {topCategories.length > 0 ? (
                    <ol className="top-category-list">
                      {topCategories.map(([category, count], index) => (
                        <li key={category}>
                          <span className="top-category-rank">{String(index + 1).padStart(2, "0")}</span>
                          <span className="top-category-name">{category}</span>
                          <strong>{count}</strong>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="analytics-empty">
                      {complaintsReady && !analyticsRangeInvalid
                        ? "No categories to rank for this date range."
                        : "Complaint data is unavailable for analytics."}
                    </p>
                  )}
                </article>
              </section>

              <section className="content-card authority-map-card">
                <div className="card-heading">
                  <div>
                    <h3>Complaint locations</h3>
                    <p>Only complaints with saved, valid GPS coordinates appear on the map.</p>
                  </div>
                  <span className="authority-result-count">
                    {authorityMapComplaints.length} mapped
                  </span>
                </div>
                {authorityMapComplaints.length > 0 ? (
                  <>
                    <div className="authority-map-legend" aria-label="Map status legend">
                      <span><i className="map-legend-dot pending" /> Pending</span>
                      <span><i className="map-legend-dot in-progress" /> In Progress</span>
                      <span><i className="map-legend-dot resolved" /> Resolved</span>
                    </div>
                    <Suspense fallback={<div className="location-map authority-locations-map location-map-loading">Loading map...</div>}>
                      <LocationMap
                        markers={authorityMapComplaints.map((complaint) => ({
                          id: complaint.id,
                          title: complaint.title,
                          category: complaint.category,
                          location: complaint.location,
                          status: complaint.status,
                          latitude: complaint.latitude,
                          longitude: complaint.longitude,
                        }))}
                        className="authority-locations-map"
                      />
                    </Suspense>
                  </>
                ) : (
                  <p className="empty-state authority-map-empty">
                    No complaints with valid saved coordinates are available.
                  </p>
                )}
              </section>

              <section className="content-card authority-complaints">
                <div className="card-heading">
                  <div>
                    <h3>All complaints</h3>
                    <p>Search and filter the latest complaint records.</p>
                  </div>
                  <span className="authority-result-count">
                    {complaintsReady ? `${authorityFiltered.length} shown` : "Loading..."}
                  </span>
                </div>

                <div className="authority-filters">
                  <label className="authority-search">
                    <span>Search complaints</span>
                    <input
                      type="search"
                      placeholder="Code, title, category or location"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Status</span>
                    <select
                      value={authorityStatusFilter}
                      onChange={(event) => setAuthorityStatusFilter(event.target.value)}
                    >
                      <option>All statuses</option>
                      <option>Pending</option>
                      <option>In Progress</option>
                      <option>Resolved</option>
                    </select>
                  </label>
                  <label>
                    <span>Category</span>
                    <select
                      value={authorityCategoryFilter}
                      onChange={(event) => setAuthorityCategoryFilter(event.target.value)}
                    >
                      <option>All categories</option>
                      {authorityCategories.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <ComplaintTable
                  complaints={authorityFiltered}
                  onSelect={selectComplaint}
                  showStatusControl
                  updateStatus={updateStatus}
                  statusUpdatingFor={statusUpdatingFor}
                  emptyMessage={complaintsReady ? "No complaints match these filters." : "Loading complaints..."}
                />
              </section>
            </section>
          )}

          {activePage === "Complaint Details" && visibleSelected && (
            <section className="complaint-detail-view">
              <button
                type="button"
                className="secondary-btn detail-back-btn"
                onClick={() => {
                  setPage("Dashboard");
                  setSelected(null);
                }}
              >
                ← Back to Dashboard
              </button>

              <article className="content-card complaint-detail-card">
                <div className="detail-heading">
                  <div>
                    <span className="eyebrow">COMPLAINT DETAILS</span>
                    <p className="complaint-id">Complaint code: {visibleSelected.id}</p>
                  </div>
                  <StatusBadge status={visibleSelected.status} />
                </div>

                <h1 className="detail-title">{visibleSelected.title}</h1>

                <div className="detail-facts">
                  <div className="detail-fact">
                    <span>Category</span>
                    <strong>{visibleSelected.category}</strong>
                  </div>
                  <div className="detail-fact">
                    <span>Location</span>
                    <strong>{visibleSelected.location}</strong>
                  </div>
                  <div className="detail-fact">
                    <span>Submission date</span>
                    <strong>{visibleSelected.date}</strong>
                  </div>
                </div>

                <div className="detail-section">
                  <h2>Description</h2>
                  <p className="detail-description">{visibleSelected.description}</p>
                </div>

                <div className="detail-section">
                  <h2>Progress</h2>
                  <ComplaintProgress status={visibleSelected.status} />
                </div>

                <section className="detail-section official-response-card" aria-labelledby="official-response-title">
                  <div className="official-response-heading">
                    <span className="official-response-icon" aria-hidden="true">✓</span>
                    <div>
                      <h2 id="official-response-title">Official Authority Response</h2>
                      <p>Updates from the verified authority team.</p>
                    </div>
                  </div>
                  {visibleSelected.officialResponse ? (
                    <>
                      <p className="official-response-text">{visibleSelected.officialResponse}</p>
                      {visibleSelected.officialResponseAt && (
                        <time
                          className="official-response-date"
                          dateTime={visibleSelected.officialResponseAt}
                        >
                          Updated {formatResponseDate(visibleSelected.officialResponseAt)}
                        </time>
                      )}
                    </>
                  ) : (
                    <p className="official-response-empty">
                      {visibleSelected.officialResponseSupported
                        ? "No official response has been posted yet."
                        : "Official responses are not available until the database migration is applied."}
                    </p>
                  )}
                </section>

                <div className="detail-section complaint-photos-section">
                  <h2>Photos</h2>
                  {currentPhotosState.loading && <p className="photo-status">Loading complaint photos...</p>}
                  {currentPhotosState.error && <p className="photo-error" role="alert">{currentPhotosState.error}</p>}
                  {!currentPhotosState.loading && !currentPhotosState.error && currentPhotosState.photos.length === 0 && (
                    <p className="photo-status">No photos were attached to this complaint.</p>
                  )}
                  {currentPhotosState.photos.length > 0 && (
                    <div className="complaint-photo-grid">
                      {currentPhotosState.photos.map((photo, index) => (
                        <a
                          className="complaint-photo"
                          href={photo.url}
                          target="_blank"
                          rel="noreferrer"
                          key={photo.name}
                        >
                          <img src={photo.url} alt={`Complaint photo ${index + 1}`} />
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {isAuthority && !isRoleLoading && (
                  <div className="authority-detail-controls">
                    <div className="detail-section">
                      <h2>Update status</h2>
                      <label className="authority-detail-status">
                        <span>Current complaint status</span>
                        <select
                          className="status-select"
                          value={visibleSelected.status}
                          disabled={statusUpdatingFor === visibleSelected.id}
                          onChange={(event) => updateStatus(visibleSelected.id, event.target.value)}
                        >
                          <option>Pending</option>
                          <option>In Progress</option>
                          <option>Resolved</option>
                        </select>
                      </label>
                    </div>
                    <div className="detail-section">
                      <h2>Publish an official response</h2>
                      <label className="authority-note-field">
                        <span>Official Authority Response</span>
                        <textarea
                          value={
                            officialResponseDraft.complaintId === visibleSelected.id
                              ? officialResponseDraft.text
                              : visibleSelected.officialResponse || ""
                          }
                          onChange={(event) => {
                            setOfficialResponseDraft({
                              complaintId: visibleSelected.id,
                              text: event.target.value,
                            });
                            setResponseError("");
                          }}
                          disabled={
                            !visibleSelected.officialResponseSupported ||
                            responseSavingFor === visibleSelected.id
                          }
                          rows="4"
                          maxLength={2000}
                          placeholder={
                            visibleSelected.officialResponseSupported
                              ? "Write a clear update for the citizen..."
                              : "Response storage requires the database migration."
                          }
                          aria-describedby="official-response-help"
                        />
                      </label>
                      <p className="form-hint" id="official-response-help">
                        Responses are visible to citizens who can access this complaint. Saving again updates the existing response and timestamp.
                      </p>
                      {responseError && <p className="response-error" role="alert">{responseError}</p>}
                      <button
                        type="button"
                        className="primary-btn official-response-save"
                        onClick={() => saveOfficialResponse(visibleSelected)}
                        disabled={
                          !visibleSelected.officialResponseSupported ||
                          responseSavingFor === visibleSelected.id ||
                          !isAuthority ||
                          isRoleLoading
                        }
                      >
                        {responseSavingFor === visibleSelected.id
                          ? "Saving response..."
                          : visibleSelected.officialResponse
                            ? "Update official response"
                            : "Publish official response"}
                      </button>
                      {!visibleSelected.officialResponseSupported && (
                        <p className="form-hint">
                          Apply the separate official-response migration before publishing responses.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </article>
            </section>
          )}
        </div>

        <footer className="main-footer">
          <span>Made for communities, with care. ♡</span>
          <span>JanVoice · Civic Issue Reporting</span>
        </footer>
      </main>

    </div>
  );
}

function buildComplaintTrend(complaints, startDate, endDate) {
  const validDates = complaints
    .map((complaint) => Date.parse(complaint.createdAt))
    .filter(Number.isFinite)
    .map((timestamp) => new Date(timestamp));

  if (validDates.length === 0) {
    return { interval: "month", points: [] };
  }

  const { earliestTime, latestTime } = validDates.reduce(
    (range, date) => ({
      earliestTime: Math.min(range.earliestTime, date.getTime()),
      latestTime: Math.max(range.latestTime, date.getTime()),
    }),
    {
      earliestTime: Number.POSITIVE_INFINITY,
      latestTime: Number.NEGATIVE_INFINITY,
    }
  );
  const earliest = new Date(earliestTime);
  const latest = new Date(latestTime);
  const rangeStart = startDate
    ? new Date(`${startDate}T00:00:00.000Z`)
    : new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), earliest.getUTCDate()));
  const rangeEnd = endDate
    ? new Date(`${endDate}T00:00:00.000Z`)
    : new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate()));
  const daySpan = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86400000);
  const interval = daySpan <= 62 ? "day" : "month";
  const countsByPeriod = new Map();

  complaints.forEach((complaint) => {
    const timestamp = Date.parse(complaint.createdAt);
    if (!Number.isFinite(timestamp)) return;
    const date = new Date(timestamp);
    const key = interval === "day"
      ? date.toISOString().slice(0, 10)
      : date.toISOString().slice(0, 7);
    countsByPeriod.set(key, (countsByPeriod.get(key) || 0) + 1);
  });

  const points = [];
  const cursor = new Date(rangeStart);
  if (interval === "month") cursor.setUTCDate(1);
  const last = new Date(rangeEnd);
  if (interval === "month") last.setUTCDate(1);

  while (cursor <= last) {
    const key = interval === "day"
      ? cursor.toISOString().slice(0, 10)
      : cursor.toISOString().slice(0, 7);
    const label = interval === "day"
      ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(cursor)
      : new Intl.DateTimeFormat("en", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(cursor);
    points.push({ key, label, count: countsByPeriod.get(key) || 0 });

    if (interval === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return { interval, points };
}

function formatResponseDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "date unavailable";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ComplaintTrendChart({ trend }) {
  const { points } = trend;
  const width = 760;
  const height = 250;
  const padding = { top: 20, right: 22, bottom: 42, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(1, ...points.map((point) => point.count));
  const midTick = Math.ceil(maximum / 2);
  const yTicks = [...new Set([0, midTick, maximum])];
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: points.length === 1
      ? padding.left + chartWidth / 2
      : padding.left + (index / (points.length - 1)) * chartWidth,
    y: padding.top + chartHeight - (point.count / maximum) * chartHeight,
  }));
  const linePoints = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const labelIndices = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return (
    <div className="trend-chart-wrap">
      <svg
        className="trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${points.reduce((total, point) => total + point.count, 0)} complaints over ${points.length} ${trend.interval === "day" ? "days" : "months"}`}
      >
        {yTicks.map((tick) => {
          const y = padding.top + chartHeight - (tick / maximum) * chartHeight;
          return (
            <g key={tick}>
              <line className="trend-grid-line" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text className="trend-axis-label" x={padding.left - 10} y={y + 4} textAnchor="end">{tick}</text>
            </g>
          );
        })}
        {points.length > 1 && <polyline className="trend-chart-line" points={linePoints} />}
        {chartPoints.map((point) => (
          <circle className="trend-chart-point" cx={point.x} cy={point.y} r="4" key={point.key}>
            <title>{`${point.label}: ${point.count} complaints`}</title>
          </circle>
        ))}
        {labelIndices.map((index) => {
          const point = chartPoints[index];
          return (
            <text
              className="trend-axis-label"
              x={point.x}
              y={height - 13}
              textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
              key={point.key}
            >
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function SearchBox({ search, setSearch, onTrack }) {
  return (
    <div className="search-box">
      <span>⌕</span>
      <input
        placeholder="Search complaints, categories or locations..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <button onClick={onTrack}>
        Track by ID
      </button>
    </div>
  );
}

function StatusBadge({ status }) {
  const cls = status.toLowerCase().replace(" ", "-");
  return <span className={`status-badge ${cls}`}>{status}</span>;
}

function AuthorityStat({ label, value, icon, tone, note = "Across all complaints" }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${tone}`}>{icon}</span>
      </div>
      <h2>{value}</h2>
      <p className="stat-note">{note}</p>
    </div>
  );
}

function ComplaintProgress({ status }) {
  const steps = ["Submitted", "In Progress", "Resolved"];
  const currentStep = status === "In Progress" ? 1 : status === "Resolved" ? 2 : 0;

  return (
    <ol className="complaint-progress" aria-label={`Complaint progress: ${status}`}>
      {steps.map((step, index) => {
        const stepState =
          index < currentStep ? "complete" : index === currentStep ? "current" : "upcoming";

        return (
          <li className={`progress-step ${stepState}`} key={step}>
            <span className="progress-marker" aria-hidden="true">
              {index < currentStep ? "✓" : index + 1}
            </span>
            <span className="progress-label">{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ComplaintTable({
  complaints,
  onSelect,
  showStatusControl,
  updateStatus,
  statusUpdatingFor,
  emptyMessage,
}) {
  if (complaints.length === 0) {
    return <p className="empty-state">{emptyMessage || "No complaints yet. Report an issue to get started."}</p>;
  }

  return (
    <div className="table-wrap">
      <table className="complaint-table">
        <thead><tr><th>COMPLAINT</th><th>CATEGORY</th><th>LOCATION</th><th>STATUS</th><th>DATE</th></tr></thead>
        <tbody>
          {complaints.map((c) => (
            <tr key={c.id}>
              <td><button className="complaint-link" onClick={() => onSelect(c)}><strong>{c.title}</strong><small>{c.id}</small></button></td>
              <td><span className="category-cell">{c.category}</span></td>
              <td>{c.location}</td>
              <td>
                {showStatusControl ? (
                  <select
                    className="status-select"
                    value={c.status}
                    disabled={statusUpdatingFor === c.id}
                    onChange={(e) => updateStatus(c.id, e.target.value)}
                    aria-label={`Update ${c.id} status`}
                  >
                    <option>Pending</option><option>In Progress</option><option>Resolved</option>
                  </select>
                ) : <StatusBadge status={c.status} />}
              </td>
              <td>{c.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
