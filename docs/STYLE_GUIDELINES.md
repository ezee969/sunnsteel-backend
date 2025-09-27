# Sunnsteel Backend - Documentation Style Guidelines

## Executive Summary

This document establishes comprehensive style guidelines and templates for the Sunnsteel Backend documentation project. These standards ensure consistency, professionalism, and maintainability across all documentation components.

## Table of Contents

1. [Writing Style Guidelines](#writing-style-guidelines)
2. [Document Structure Standards](#document-structure-standards)
3. [Formatting Conventions](#formatting-conventions)
4. [Code Documentation Standards](#code-documentation-standards)
5. [Visual Elements Guidelines](#visual-elements-guidelines)
6. [File Organization Standards](#file-organization-standards)
7. [Templates](#templates)
8. [Review and Quality Assurance](#review-and-quality-assurance)

---

## Writing Style Guidelines

### Voice and Tone

#### **Professional Technical Writing**
- **Voice**: Active voice preferred over passive voice
- **Tone**: Professional, clear, and helpful
- **Perspective**: Second person ("you") for instructions, third person for descriptions
- **Formality**: Professional but approachable

#### **Examples**
```markdown
✅ Good: "Configure the database connection in your .env file"
❌ Avoid: "The database connection should be configured in the .env file"

✅ Good: "This endpoint returns user profile information"
❌ Avoid: "User profile information is returned by this endpoint"
```

### Language Standards

#### **Clarity and Concision**
- Use clear, simple language
- Avoid jargon unless necessary (define when used)
- Keep sentences under 25 words when possible
- Use bullet points for lists of 3+ items
- Break up long paragraphs (max 4-5 sentences)

#### **Technical Terminology**
- Define acronyms on first use: "Reps to Failure (RtF)"
- Use consistent terminology throughout documentation
- Maintain a glossary for domain-specific terms
- Use proper capitalization for technical terms

#### **Grammar and Style**
- Use Oxford comma in lists
- Capitalize proper nouns and official names
- Use present tense for current functionality
- Use future tense for planned features
- Use imperative mood for instructions

---

## Document Structure Standards

### Standard Document Template

```markdown
# [Module/Feature Name] - [Document Title]

## Overview
Brief description of the module/feature and its purpose.

## Table of Contents
1. [Section 1](#section-1)
2. [Section 2](#section-2)
...

## [Main Content Sections]
...

## Related Documentation
- [Link to related docs]

## Changelog
| Date | Version | Changes | Author |
|------|---------|---------|--------|
| YYYY-MM-DD | 1.0 | Initial version | Name |

---
**Last Updated**: [Date]  
**Reviewer**: [Name]  
**Next Review**: [Date]
```

### Section Hierarchy

#### **Heading Levels**
- `#` - Document title only
- `##` - Major sections
- `###` - Subsections
- `####` - Sub-subsections (use sparingly)
- `#####` - Avoid (restructure document instead)

#### **Section Organization**
1. **Overview/Introduction** - Purpose and scope
2. **Prerequisites** - Required knowledge/setup
3. **Main Content** - Core information
4. **Examples** - Practical demonstrations
5. **Troubleshooting** - Common issues
6. **Related Documentation** - Cross-references
7. **Changelog** - Version history

---

## Formatting Conventions

### Text Formatting

#### **Emphasis Guidelines**
- **Bold** (`**text**`): Important concepts, warnings, field names
- *Italic* (`*text*`): Emphasis, first use of terms, file names
- `Code` (`` `text` ``): Code elements, commands, file paths
- ~~Strikethrough~~ (`~~text~~`): Deprecated features

#### **Lists and Structure**
```markdown
# Ordered Lists (for sequences)
1. First step
2. Second step
3. Third step

# Unordered Lists (for non-sequential items)
- Feature A
- Feature B
- Feature C

# Nested Lists
1. Main item
   - Sub-item A
   - Sub-item B
2. Second main item
   - Sub-item C
```

### Code Formatting

#### **Inline Code**
- Use backticks for: variables, functions, file names, commands
- Examples: `userId`, `getUserProfile()`, `package.json`, `npm install`

#### **Code Blocks**
```markdown
# Language-specific syntax highlighting
```typescript
interface UserProfile {
  id: string
  email: string
  name: string
}
```

# Command line examples
```bash
npm install
npm run dev
```

# Configuration examples
```env
DATABASE_URL="postgresql://..."
JWT_SECRET="your-secret-key"
```
```

#### **API Examples**
```markdown
# Request Example
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```

# Response Example
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "email": "user@example.com",
      "name": "John Doe"
    }
  }
}
```
```

### Tables

#### **Standard Table Format**
```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| Data 4   | Data 5   | Data 6   |
```

#### **API Reference Tables**
```markdown
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | User email address |
| `password` | string | Yes | User password (min 8 chars) |
| `name` | string | No | User display name |
```

---

## Code Documentation Standards

### API Documentation Format

#### **Endpoint Documentation Template**
```markdown
### POST /api/auth/login

**Description**: Authenticates a user and returns a JWT token.

**Authentication**: None required

**Request Body**:
```typescript
interface LoginRequest {
  email: string    // User email address
  password: string // User password
}
```

**Response**:
```typescript
interface LoginResponse {
  success: boolean
  data: {
    token: string
    user: UserProfile
  }
}
```

**Example Request**:
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Example Response**:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "email": "user@example.com",
      "name": "John Doe"
    }
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid email or password format
- `401 Unauthorized`: Invalid credentials
- `429 Too Many Requests`: Rate limit exceeded

**Related Endpoints**:
- [POST /api/auth/register](#post-apiauthregister)
- [POST /api/auth/refresh](#post-apiauthrefresh)
```

### Configuration Documentation

#### **Environment Variables Template**
```markdown
### Database Configuration

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `DATABASE_URL` | string | Yes | - | PostgreSQL connection string |
| `DB_POOL_SIZE` | number | No | 10 | Maximum database connections |
| `DB_TIMEOUT` | number | No | 30000 | Query timeout in milliseconds |

**Example**:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/sunnsteel"
DB_POOL_SIZE=20
DB_TIMEOUT=60000
```

**Notes**:
- Use connection pooling in production environments
- Timeout should be adjusted based on query complexity
```

---

## Visual Elements Guidelines

### Diagrams and Charts

#### **Architecture Diagrams**
- Use consistent symbols and colors
- Include legend when necessary
- Keep diagrams simple and focused
- Use tools like Mermaid for text-based diagrams

#### **Mermaid Diagram Examples**
```markdown
# Flow Diagram
```mermaid
graph TD
    A[User Request] --> B{Authentication}
    B -->|Valid| C[Process Request]
    B -->|Invalid| D[Return Error]
    C --> E[Return Response]
```

# Sequence Diagram
```mermaid
sequenceDiagram
    participant U as User
    participant A as Auth Service
    participant D as Database
    
    U->>A: Login Request
    A->>D: Validate Credentials
    D-->>A: User Data
    A-->>U: JWT Token
```
```

### Callouts and Alerts

#### **Standard Callout Types**
```markdown
> **Note**: Additional information that might be helpful.

> **Warning**: Important information that could prevent errors.

> **Danger**: Critical information about potential data loss or security issues.

> **Tip**: Helpful suggestions or best practices.
```

#### **Formatted Callouts**
```markdown
### ⚠️ Important Security Notice
Always validate JWT tokens on the server side. Client-side validation is insufficient for security purposes.

### 💡 Performance Tip
Use connection pooling to improve database performance in production environments.

### 🔧 Troubleshooting
If you encounter connection errors, verify your DATABASE_URL format and network connectivity.
```

---

## File Organization Standards

### Directory Structure

```
docs/
├── README.md                    # Documentation index
├── DOCUMENTATION_PLAN.md        # Master documentation plan
├── CONTENT_OUTLINES.md         # Detailed content outlines
├── IMPLEMENTATION_TIMELINE.md   # Implementation schedule
├── STYLE_GUIDELINES.md         # This document
├── getting-started/            # New user onboarding
│   ├── INSTALLATION.md
│   ├── QUICK_START.md
│   ├── DEVELOPMENT.md
│   └── TROUBLESHOOTING.md
├── architecture/               # System architecture
│   ├── OVERVIEW.md
│   ├── DATABASE_SCHEMA.md
│   ├── AUTHENTICATION.md
│   ├── CACHING.md
│   └── SECURITY.md
├── api/                       # API documentation
│   ├── README.md
│   ├── AUTHENTICATION.md
│   ├── USERS.md
│   ├── EXERCISES.md
│   ├── ROUTINES.md
│   ├── WORKOUTS.md
│   ├── METRICS.md
│   ├── SCHEMAS.md
│   └── ERROR_CODES.md
├── modules/                   # Module-specific docs
│   ├── auth/
│   ├── users/
│   ├── exercises/
│   ├── routines/
│   ├── workouts/
│   ├── cache/
│   └── metrics/
├── features/                  # Feature documentation
│   ├── RTF_SYSTEM.md
│   ├── TRAINING_MAX.md
│   ├── SESSION_MANAGEMENT.md
│   └── BACKGROUND_SERVICES.md
├── development/               # Development processes
│   ├── TESTING.md
│   ├── CODE_STYLE.md
│   └── CONTRIBUTING.md
├── deployment/                # Deployment guides
│   ├── PRODUCTION.md
│   ├── MONITORING.md
│   └── SCALING.md
├── reference/                 # Reference materials
│   ├── CONFIGURATION.md
│   ├── ENVIRONMENT_VARIABLES.md
│   └── GLOSSARY.md
├── roadmaps/                  # Future plans
│   ├── RTF_ENHANCEMENTS.md
│   └── PERFORMANCE_IMPROVEMENTS.md
└── history/                   # Historical records
    ├── TM_ADJUSTMENTS_COMPLETION.md
    └── ARCHITECTURE_DECISIONS.md
```

### File Naming Conventions

#### **File Names**
- Use UPPERCASE for main documentation files
- Use snake_case for multi-word files
- Use descriptive, specific names
- Include version numbers for versioned docs

#### **Examples**
```
✅ Good:
- INSTALLATION.md
- API_REFERENCE.md
- QUICK_START.md
- RTF_SYSTEM.md

❌ Avoid:
- install.md
- api.md
- start.md
- rtf.md
```

### Cross-Reference Standards

#### **Internal Links**
```markdown
# Relative links within docs
[Installation Guide](../getting-started/INSTALLATION.md)
[API Reference](./API_REFERENCE.md)

# Anchor links within document
[Configuration Section](#configuration)
[Error Handling](#error-handling)

# Links to specific sections in other documents
[Database Schema](../architecture/DATABASE_SCHEMA.md#user-model)
```

#### **External Links**
```markdown
# External documentation
[NestJS Documentation](https://docs.nestjs.com/)
[Prisma Documentation](https://www.prisma.io/docs/)

# Repository links
[Source Code](https://github.com/organization/sunnsteel-backend)
[Issue Tracker](https://github.com/organization/sunnsteel-backend/issues)
```

---

## Templates

### Module Documentation Template

```markdown
# [Module Name] Module

## Overview
Brief description of the module's purpose and functionality.

## Architecture
Description of the module's internal structure and components.

### Components
- **Controller**: Handles HTTP requests and responses
- **Service**: Contains business logic
- **DTOs**: Data transfer objects for validation
- **Guards**: Authentication and authorization
- **Types**: TypeScript type definitions

## Features
List of main features provided by this module.

### Feature 1
Detailed description of the feature.

### Feature 2
Detailed description of the feature.

## Configuration
Required configuration options and environment variables.

```env
# Example configuration
MODULE_SETTING="value"
```

## API Endpoints
List of endpoints provided by this module.

### GET /api/module/endpoint
Brief description of the endpoint.

## Dependencies
- Internal dependencies (other modules)
- External dependencies (npm packages)

## Testing
Information about testing this module.

## Troubleshooting
Common issues and solutions.

## Related Documentation
- [Related Module](../other-module/README.md)
- [API Reference](../../api/MODULE.md)

---
**Last Updated**: [Date]  
**Reviewer**: [Name]  
**Next Review**: [Date]
```

### API Endpoint Template

```markdown
### [METHOD] /api/path/to/endpoint

**Description**: Brief description of what this endpoint does.

**Authentication**: Required authentication type (JWT, Supabase, None)

**Authorization**: Required permissions or roles

**Rate Limiting**: Rate limit information if applicable

**Request Parameters**:

| Parameter | Type | Location | Required | Description |
|-----------|------|----------|----------|-------------|
| `param1` | string | path | Yes | Description |
| `param2` | number | query | No | Description |

**Request Body**:
```typescript
interface RequestBody {
  field1: string    // Description
  field2?: number   // Optional field description
}
```

**Response**:
```typescript
interface SuccessResponse {
  success: true
  data: ResponseData
}

interface ErrorResponse {
  success: false
  error: {
    code: string
    message: string
  }
}
```

**Example Request**:
```http
[METHOD] /api/path/to/endpoint
Authorization: Bearer [token]
Content-Type: application/json

{
  "field1": "value1",
  "field2": 123
}
```

**Example Response**:
```json
{
  "success": true,
  "data": {
    "result": "example"
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid request format
- `401 Unauthorized`: Authentication required
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Resource not found
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error

**Related Endpoints**:
- [Related Endpoint 1](#related-endpoint-1)
- [Related Endpoint 2](#related-endpoint-2)

**Notes**:
- Additional notes or considerations
- Performance considerations
- Security considerations
```

### Feature Documentation Template

```markdown
# [Feature Name]

## Overview
Comprehensive description of the feature and its business value.

## Use Cases
Primary use cases and scenarios where this feature is used.

### Use Case 1: [Name]
Description of the use case and workflow.

### Use Case 2: [Name]
Description of the use case and workflow.

## Architecture
Technical architecture and design decisions.

### Components
List of components involved in this feature.

### Data Flow
Description of how data flows through the system.

```mermaid
graph TD
    A[Input] --> B[Processing]
    B --> C[Output]
```

## Implementation Details

### Database Schema
Relevant database tables and relationships.

### API Endpoints
Endpoints related to this feature.

### Business Logic
Core algorithms and business rules.

## Configuration
Feature-specific configuration options.

## Performance Considerations
Performance characteristics and optimization strategies.

## Security Considerations
Security implications and safeguards.

## Testing Strategy
How this feature is tested.

## Monitoring and Metrics
Metrics and monitoring for this feature.

## Troubleshooting
Common issues and debugging approaches.

## Future Enhancements
Planned improvements and extensions.

## Related Documentation
- [Related Feature](./RELATED_FEATURE.md)
- [API Documentation](../api/FEATURE_API.md)

---
**Last Updated**: [Date]  
**Reviewer**: [Name]  
**Next Review**: [Date]
```

---

## Review and Quality Assurance

### Documentation Review Process

#### **Review Checklist**
- [ ] **Content Accuracy**: Technical information is correct and up-to-date
- [ ] **Completeness**: All required sections are present and complete
- [ ] **Clarity**: Information is clear and easy to understand
- [ ] **Consistency**: Follows style guidelines and templates
- [ ] **Links**: All internal and external links work correctly
- [ ] **Code Examples**: All code examples are tested and functional
- [ ] **Grammar**: Proper grammar, spelling, and punctuation
- [ ] **Formatting**: Consistent formatting and structure

#### **Review Roles**
- **Technical Reviewer**: Validates technical accuracy and completeness
- **Style Reviewer**: Ensures adherence to style guidelines
- **User Experience Reviewer**: Evaluates usability and clarity
- **Final Approver**: Signs off on completed documentation

### Quality Metrics

#### **Measurable Standards**
- **Link Validation**: 100% of links must be functional
- **Code Testing**: 100% of code examples must be tested
- **Review Coverage**: 100% of documents must be reviewed
- **Update Frequency**: Documentation updated within 48 hours of code changes

#### **Quality Gates**
1. **Draft Review**: Initial technical and content review
2. **Style Review**: Style and formatting compliance check
3. **User Testing**: Usability testing with target audience
4. **Final Approval**: Stakeholder sign-off and publication

### Maintenance Standards

#### **Regular Maintenance Tasks**
- **Weekly**: Link validation and broken link fixes
- **Monthly**: Content accuracy review and updates
- **Quarterly**: Comprehensive style and structure review
- **Annually**: Complete documentation audit and reorganization

#### **Update Triggers**
- **Code Changes**: Automatic documentation update requirements
- **API Modifications**: Immediate API documentation updates
- **Feature Releases**: New feature documentation requirements
- **Bug Fixes**: Troubleshooting guide updates

---

## Tools and Automation

### Recommended Tools

#### **Documentation Tools**
- **Markdown Editor**: VS Code with Markdown extensions
- **Diagram Creation**: Mermaid, Draw.io, or Lucidchart
- **Link Validation**: markdown-link-check
- **Spell Check**: Code Spell Checker extension
- **Grammar Check**: Grammarly or similar tools

#### **Automation Tools**
- **CI/CD Integration**: Automated link checking and validation
- **Documentation Generation**: Automated API documentation from code
- **Change Detection**: Git hooks for documentation update reminders
- **Metrics Collection**: Documentation usage and effectiveness tracking

### Validation Scripts

#### **Link Validation**
```bash
# Check all markdown files for broken links
find docs -name "*.md" -exec markdown-link-check {} \;
```

#### **Style Validation**
```bash
# Check markdown formatting
markdownlint docs/**/*.md
```

#### **Content Validation**
```bash
# Validate code examples
npm run test:docs
```

---

**Document Version**: 1.0  
**Last Updated**: January 2025  
**Next Review**: February 2025  
**Style Guide Owner**: Technical Writing Team  
**Approved By**: Documentation Committee