export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      appointments: {
        Row: {
          casa_id: string
          created_at: string
          description: string | null
          id: string
          kind: string
          location: string | null
          person: string | null
          reminder_at: string | null
          starts_at: string
          title: string
          user_id: string | null
        }
        Insert: {
          casa_id: string
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          location?: string | null
          person?: string | null
          reminder_at?: string | null
          starts_at: string
          title: string
          user_id?: string | null
        }
        Update: {
          casa_id?: string
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          location?: string | null
          person?: string | null
          reminder_at?: string | null
          starts_at?: string
          title?: string
          user_id?: string | null
        }
        Relationships: []
      }
      appointment_kinds: {
        Row: {
          casa_id: string
          created_at: string
          icon: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          casa_id: string
          created_at?: string
          icon?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          casa_id?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      casa_members: {
        Row: {
          casa_id: string
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          casa_id: string
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          casa_id?: string
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      casas: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          invite_code: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          invite_code?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          invite_code?: string
          name?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          budget: number | null
          casa_id: string
          color: string
          created_at: string
          icon: string
          id: string
          name: string
        }
        Insert: {
          budget?: number | null
          casa_id: string
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name: string
        }
        Update: {
          budget?: number | null
          casa_id?: string
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          birth_date: string
          casa_id: string
          created_at: string
          id: string
          name: string
          phone: string | null
          relationship: string | null
          user_id: string | null
        }
        Insert: {
          birth_date: string
          casa_id: string
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          relationship?: string | null
          user_id?: string | null
        }
        Update: {
          birth_date?: string
          casa_id?: string
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          relationship?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          casa_id: string
          category_id: string | null
          created_at: string
          id: string
          note: string | null
          spent_at: string
          title: string
          user_id: string | null
        }
        Insert: {
          amount: number
          casa_id: string
          category_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          spent_at?: string
          title: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          casa_id?: string
          category_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          spent_at?: string
          title?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      shopping_items: {
        Row: {
          casa_id: string
          created_at: string
          done: boolean
          id: string
          list_id: string
          name: string
          quantity: number | null
          unit: string | null
        }
        Insert: {
          casa_id: string
          created_at?: string
          done?: boolean
          id?: string
          list_id: string
          name: string
          quantity?: number | null
          unit?: string | null
        }
        Update: {
          casa_id?: string
          created_at?: string
          done?: boolean
          id?: string
          list_id?: string
          name?: string
          quantity?: number | null
          unit?: string | null
        }
        Relationships: []
      }
      shopping_lists: {
        Row: {
          casa_id: string
          created_at: string
          done: boolean
          id: string
          title: string
          user_id: string | null
        }
        Insert: {
          casa_id: string
          created_at?: string
          done?: boolean
          id?: string
          title: string
          user_id?: string | null
        }
        Update: {
          casa_id?: string
          created_at?: string
          done?: boolean
          id?: string
          title?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_invite_code: { Args: never; Returns: string }
      is_casa_member: { Args: { casa: string }; Returns: boolean }
      is_casa_owner: { Args: { casa: string }; Returns: boolean }
      join_casa: {
        Args: { code: string }
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          invite_code: string
          name: string
        }
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