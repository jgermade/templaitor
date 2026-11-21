{{- define "templaitor.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "templaitor.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "templaitor.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "templaitor.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "templaitor.selectorLabels" -}}
app.kubernetes.io/name: {{ include "templaitor.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "templaitor.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "templaitor.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "templaitor.secretName" -}}
{{- default (include "templaitor.fullname" .) .Values.secret.existingSecret }}
{{- end }}

{{- define "templaitor.baseUrl" -}}
{{- if .Values.config.baseUrl }}
{{- .Values.config.baseUrl }}
{{- else if and .Values.ingress.enabled .Values.ingress.hosts }}
{{- printf "%s://%s" (ternary "https" "http" (gt (len .Values.ingress.tls) 0)) (index .Values.ingress.hosts 0).host }}
{{- else }}
{{- printf "http://%s.%s.svc:%v" (include "templaitor.fullname" .) .Release.Namespace .Values.service.port }}
{{- end }}
{{- end }}

{{/* Fails early on configurations that cannot work */}}
{{- define "templaitor.validate" -}}
{{- if and (gt (int .Values.replicaCount) 1) (ne .Values.config.database.driver "postgres") }}
{{- fail "replicaCount > 1 needs config.database.driver=postgres (SQLite is single-instance)" }}
{{- end }}
{{- if and (gt (int .Values.replicaCount) 1) (ne .Values.config.storage "db") }}
{{- fail "replicaCount > 1 needs config.storage=db (templates in the database, not on one volume)" }}
{{- end }}
{{- if and (eq .Values.config.database.driver "postgres") (not .Values.config.database.url) (not .Values.secret.existingSecret) }}
{{- fail "config.database.driver=postgres needs config.database.url (or secret.existingSecret with TEMPLAITOR_DATABASE_URL)" }}
{{- end }}
{{- end }}
