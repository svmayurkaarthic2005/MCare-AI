
# 🏥 MCare – Healthcare Management Platform

**MCare** is a full-stack healthcare management platform designed to digitally streamline patient–doctor interactions while ensuring **data security, real-time communication, and efficient medical workflows**.

The platform centralizes appointments, emergency handling, prescriptions, and patient health records into a secure and scalable system.

---

## 🚀 Key Features

### 👨‍⚕️ For Patients

* Book **regular or emergency appointments**
* Choose **doctor specialization**, consultation type (online/offline), and time slots
* Real-time **emergency escalation system**
* Secure **medical records & document storage**
* **Medication tracking** with daily reminders
* Complete **health history timeline**
* Notifications via **Email / WhatsApp**

### 🩺 For Doctors

* Dedicated **doctor dashboard**
* Accept or reject appointment requests
* Handle emergency cases in real time
* Upload prescriptions & consultation notes
* Manage availability and schedules
* View patient history and feedback
* Secure **Zoom integration** for online consultations

---

## 🔐 Security & Access Control

* Role-based access control (RBAC)
* Row-level security (RLS) using Supabase
* Encrypted authentication & authorization
* Secure file storage and access policies

---

## ⚙️ Tech Stack

| Layer         | Technology                                   |
| ------------- | -------------------------------------------- |
| Frontend      | React, TypeScript, Tailwind CSS              |
| Backend       | Supabase (Auth, Database, Storage, Realtime) |
| Automation    | n8n (notifications & workflows)              |
| Communication | Email, WhatsApp, Zoom                        |
| Hosting       | Vercel / Supabase                            |

---

## 📁 Project Structure

```
src/
├── components/
│   ├── auth/
│   ├── dashboard/
│   ├── debug/
│   ├── profile/
│   └── ui/
├── hooks/
├── integrations/
├── lib/
├── pages/
│   ├── Auth.tsx
│   ├── Dashboard.tsx
│   ├── DoctorDashboard.tsx
│   ├── Landing.tsx
│   └── Settings.tsx
├── App.tsx
└── main.tsx

supabase/
├── migrations/
├── functions/
└── config.toml
```

---

## 🔐 Authentication & Authorization

* Email/password signup with OTP verification
* Role-based access (Patient / Doctor)
* Secure session management using Supabase Auth
* JWT-based authentication

---

## 💾 Database Schema (Core Tables)

* `users` – User accounts & roles
* `patients` – Patient profiles and health data
* `doctors` – Doctor profiles, specialization, availability
* `appointments` – Booking and consultation data
* `emergency_bookings` – Emergency consultation records
* `prescriptions` – Medical prescriptions
* `notifications` – System and user notifications

---

## 🧑‍💻 Getting Started

### Prerequisites

* Node.js (v18+ recommended)
* npm or yarn
* Supabase account
* n8n (self-hosted or cloud)

---

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-username>/mcare.git

# Navigate to the project
cd mcare

# Install dependencies
npm install

# Start the development server
npm run dev
```

---

## 🔧 Environment Variables

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_N8N_WEBHOOK_URL=your_webhook_url
```
