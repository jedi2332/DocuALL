export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      vault_capcut_handoffs: {
        Row: {
          files: Json
          id: string
          shared_at: string
          vault_id: string
        }
        Insert: {
          files: Json
          id: string
          shared_at: string
          vault_id: string
        }
        Update: {
          files?: Json
          id?: string
          shared_at?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_capcut_handoffs_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vault_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          amount: string
          category: string
          created_at: string
          deleted_at: string | null
          doc_date: string
          id: string
          kind: string
          ocr_text: string | null
          page_count: number
          page_paths: Json
          pdf_path: string | null
          thumbnail_path: string | null
          title: string
          updated_at: string
          user_id: string
          vendor: string
        }
        Insert: {
          amount?: string
          category?: string
          created_at?: string
          deleted_at?: string | null
          doc_date?: string
          id?: string
          kind?: string
          ocr_text?: string | null
          page_count?: number
          page_paths?: Json
          pdf_path?: string | null
          thumbnail_path?: string | null
          title?: string
          updated_at?: string
          user_id: string
          vendor?: string
        }
        Update: {
          amount?: string
          category?: string
          created_at?: string
          deleted_at?: string | null
          doc_date?: string
          id?: string
          kind?: string
          ocr_text?: string | null
          page_count?: number
          page_paths?: Json
          pdf_path?: string | null
          thumbnail_path?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          vendor?: string
        }
        Relationships: []
      }
      organize_runs: {
        Row: {
          changes: Json
          created_at: string
          file_count: number
          id: string
          user_id: string
        }
        Insert: {
          changes?: Json
          created_at?: string
          file_count?: number
          id?: string
          user_id: string
        }
        Update: {
          changes?: Json
          created_at?: string
          file_count?: number
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      organize_settings: {
        Row: {
          folders: Json
          rules: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          folders?: Json
          rules?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          folders?: Json
          rules?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string
          city: string
          created_at: string
          employer: string
          full_name: string
          phone: string
          state: string
          updated_at: string
          user_id: string
          zip_code: string
        }
        Insert: {
          address?: string
          city?: string
          created_at?: string
          employer?: string
          full_name?: string
          phone?: string
          state?: string
          updated_at?: string
          user_id: string
          zip_code?: string
        }
        Update: {
          address?: string
          city?: string
          created_at?: string
          employer?: string
          full_name?: string
          phone?: string
          state?: string
          updated_at?: string
          user_id?: string
          zip_code?: string
        }
        Relationships: []
      }
      signatures: {
        Row: {
          created_at: string
          id: string
          image_path: string
          kind: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_path: string
          kind?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_path?: string
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
      signing_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          doc_id: string
          expires_at: string | null
          fields: Json
          id: string
          owner_id: string
          signer_name: string
          status: string
          token: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          doc_id: string
          expires_at?: string | null
          fields?: Json
          id?: string
          owner_id: string
          signer_name: string
          status?: string
          token: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          doc_id?: string
          expires_at?: string | null
          fields?: Json
          id?: string
          owner_id?: string
          signer_name?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "signing_requests_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_projects: {
        Row: {
          created_at: string
          files: Json
          id: string
          is_capcut: boolean
          locked: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          files?: Json
          id?: string
          is_capcut?: boolean
          locked?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          files?: Json
          id?: string
          is_capcut?: boolean
          locked?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      append_vault_files: {
        Args: { p_vault_id: string; p_files: Json }
        Returns: boolean
      }
      list_capcut_vault_tags: {
        Args: { p_vault_id: string }
        Returns: { file_path: string; file_hash: string }[]
      }
      record_capcut_handoff: {
        Args: {
          p_id: string
          p_owner_id: string
          p_vault_id: string
          p_shared_at: string
          p_files: Json
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
