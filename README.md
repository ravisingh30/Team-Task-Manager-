# TaskFlow — Team Task Manager

A full-stack web application for team collaboration with role-based access control, project management, and real-time task tracking.

![TaskFlow](https://img.shields.io/badge/Node.js-18+-green) ![Express](https://img.shields.io/badge/Express-4.x-blue) ![SQLite](https://img.shields.io/badge/SQLite-3-orange) ![JWT](https://img.shields.io/badge/Auth-JWT-yellow)

---

## Features

### Authentication & Authorization
- JWT-based signup/login with bcrypt password hashing
- Role-based access control: **Admin** and **Member** globally
- Project-level roles: **Project Admin** and **Project Member**
- First registered user auto-assigned Admin role

### Project Management
- Create, edit, archive, and delete projects
- Invite/remove members with project-level roles
- Progress tracking per project

### Task Management
- Create tasks with title, description, priority, assignee, due date
- Four statuses: **To Do → In Progress → Review → Done**
- Four priority levels: **Low, Medium, High, Critical**
- Kanban board view + list view with filters
- Quick status toggle (checkbox)
- Search by title/description, filter by priority/status

### Dashboard
- Personal task overview
- Overdue task alerts
- Stats: total, in-progress, review, done, overdue counts
- Projects overview with progress bars
- Admin: team member count

### Team Management
- Admin can view all users and toggle roles
- Project admins can add/remove project members

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Framework | Express 4.x |
| Database | SQLite (better-sqlite3) |
| Auth | JWT + bcryptjs |
| Frontend | Vanilla JS SPA (no build step) |
| Fonts | Google Fonts (Syne + DM Mono) |
| Deployment | Railway |

---

## Local Setup

### Prerequisites
- Node.js 18+
- npm

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/team-task-manager
cd team-task-manager

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set a strong JWT_SECRET

# 4. Start the server
npm start
# or for development with auto-reload:
npm run dev
```

The app will be running at **http://localhost:3000**

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `JWT_SECRET` | Secret for signing JWTs | `dev_secret_change_in_production` |
| `DB_PATH` | Path to SQLite database file | `./taskmanager.db` |

---

## Deployment on Railway

### One-click Deploy

1. Push your code to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Select your repository
4. Railway auto-detects Node.js and builds with Nixpacks
5. Add environment variables in Railway dashboard:
   - `JWT_SECRET` → a long random string (e.g. generate with `openssl rand -base64 64`)
6. Click **Deploy** — your app will be live in ~2 minutes!

### Manual via Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
# Set env vars:
railway variables set JWT_SECRET=your_secret_here
```

### Notes
- SQLite database is persisted in the Railway volume by default
- For production with high traffic, consider migrating to PostgreSQL (Railway offers it as a plugin)

---

## API Reference

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/signup` | Register new user | ❌ |
| POST | `/api/auth/login` | Login | ❌ |
| GET | `/api/auth/me` | Get current user | ✅ |
| GET | `/api/auth/users` | List all users | ✅ |
| PATCH | `/api/auth/users/:id/role` | Change user role | ✅ Admin |

#### POST /api/auth/signup
```json
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "password": "secret123",
  "role": "member"
}
```

### Projects

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/projects` | List my projects | ✅ |
| POST | `/api/projects` | Create project | ✅ |
| GET | `/api/projects/:id` | Get project details | ✅ Member |
| PUT | `/api/projects/:id` | Update project | ✅ Project Admin |
| DELETE | `/api/projects/:id` | Delete project | ✅ Project Admin |
| GET | `/api/projects/:id/members` | List members | ✅ Member |
| POST | `/api/projects/:id/members` | Add member | ✅ Project Admin |
| DELETE | `/api/projects/:id/members/:userId` | Remove member | ✅ Project Admin |

### Tasks

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/projects/:id/tasks` | List tasks | ✅ Member |
| POST | `/api/projects/:id/tasks` | Create task | ✅ Member |
| PUT | `/api/tasks/:id` | Update task | ✅ Member |
| PATCH | `/api/tasks/:id/status` | Quick status update | ✅ Member |
| DELETE | `/api/tasks/:id` | Delete task | ✅ Creator/Admin |

#### Query Parameters for GET tasks:
- `status=todo|in_progress|review|done`
- `priority=low|medium|high|critical`
- `assignee=userId`
- `search=text`

### Dashboard

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/dashboard` | Get dashboard data | ✅ |

---

## Database Schema

```sql
users           -- id, name, email, password, role, avatar_color, created_at
projects        -- id, name, description, status, owner_id, created_at
project_members -- project_id, user_id, role, joined_at
tasks           -- id, project_id, title, description, status, priority,
                --   assignee_id, created_by, due_date, created_at, updated_at
```

---

## Role & Permissions Matrix

| Action | Global Admin | Project Admin | Project Member |
|--------|-------------|---------------|----------------|
| Create project | ✅ | ✅ | ✅ |
| Edit/Delete project | ✅ | ✅ | ❌ |
| Add/Remove members | ✅ | ✅ | ❌ |
| Create tasks | ✅ | ✅ | ✅ |
| Update any task | ✅ | ✅ | ✅ |
| Delete own task | ✅ | ✅ | ✅ |
| Delete any task | ✅ | ✅ | ❌ |
| View all projects | ✅ | Own only | Own only |
| Manage user roles | ✅ | ❌ | ❌ |

---

## Project Structure

```
team-task-manager/
├── server.js        ← all backend logic (DB, auth, all routes)
├── package.json
├── railway.json
└── public/
    └── index.html   ← full SPA frontend
---

## License

MIT
